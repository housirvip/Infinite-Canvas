package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	gonanoid "github.com/matoous/go-nanoid/v2"

	"github.com/infinite-canvas/backend/internal/config"
	"github.com/infinite-canvas/backend/internal/crypto"
	"github.com/infinite-canvas/backend/internal/model"
	"github.com/infinite-canvas/backend/internal/observability"
	"github.com/infinite-canvas/backend/internal/provider"
	"github.com/infinite-canvas/backend/internal/storage"
	"github.com/infinite-canvas/backend/internal/ws"
	"gorm.io/gorm"
)

type Scheduler struct {
	db         *gorm.DB
	hub        *ws.Hub
	providers  map[string]provider.Provider
	semaphores map[string]chan struct{}
	notifyChan chan struct{}
	cancelMap  sync.Map
	fileStore  storage.FileStorage
	aesCrypto  *crypto.AESCrypto
	cfg        *config.SchedulerConfig
}

func New(db *gorm.DB, hub *ws.Hub, fileStore storage.FileStorage,
	aesCrypto *crypto.AESCrypto, cfg *config.SchedulerConfig) *Scheduler {

	s := &Scheduler{
		db:         db,
		hub:        hub,
		providers:  make(map[string]provider.Provider),
		semaphores: make(map[string]chan struct{}),
		notifyChan: make(chan struct{}, 1),
		fileStore:  fileStore,
		aesCrypto:  aesCrypto,
		cfg:        cfg,
	}

	providerList := []provider.Provider{
		provider.NewOpenAIImageProvider(),
		provider.NewOpenAIVideoProvider(cfg.Providers["openai_video"].PollMs, cfg.Providers["openai_video"].TimeoutS),
		provider.NewSeedanceVideoProvider(cfg.Providers["seedance"].PollMs, cfg.Providers["seedance"].TimeoutS),
		provider.NewRunningHubProvider(cfg.Providers["runninghub"].PollMs, cfg.Providers["runninghub"].TimeoutS),
		provider.NewComfyUIProvider(cfg.Providers["comfyui"].PollMs, cfg.Providers["comfyui"].TimeoutS),
		provider.NewRunningHubComfyUIProvider(cfg.Providers["runninghub_comfyui"].PollMs, cfg.Providers["runninghub_comfyui"].TimeoutS),
		provider.NewAudioProvider(),
	}

	for _, p := range providerList {
		s.providers[p.Name()] = p
		concurrency := 3
		if c, ok := cfg.Concurrency[p.Name()]; ok && c > 0 {
			concurrency = c
		}
		s.semaphores[p.Name()] = make(chan struct{}, concurrency)
	}

	return s
}

func (s *Scheduler) Start(ctx context.Context) {
	observability.Info(context.Background(), "scheduler starting")
	s.recoverTasks()
	go s.run(ctx)
	observability.Info(context.Background(), "scheduler started")
}

func (s *Scheduler) Enqueue(taskID string) {
	select {
	case s.notifyChan <- struct{}{}:
		observability.Debug(context.Background(), "enqueue notified", "taskId", taskID)
	default:
		observability.Debug(context.Background(), "enqueue notify skipped", "taskId", taskID, "reason", "notifyPending")
	}
}

func (s *Scheduler) Cancel(taskID string) error {
	cancelledRunning := false
	if cancel, ok := s.cancelMap.Load(taskID); ok {
		cancelledRunning = true
		cancel.(context.CancelFunc)()
	}

	var task model.Task
	if err := s.db.Where("task_id = ?", taskID).First(&task).Error; err != nil {
		observability.Error(context.Background(), "cancel load failed", "taskId", taskID, "error", err)
		return err
	}

	ctx := taskContext(&task)
	observability.Info(ctx, "cancel requested", append(taskLogAttrs(&task),
		"running", cancelledRunning,
		"status", task.Status,
		"upstreamTaskId", task.UpstreamTaskID,
	)...)

	completedAt := time.Now()
	if err := s.db.WithContext(ctx).Model(&model.Task{}).Where("task_id = ?", taskID).
		Updates(map[string]any{
			"status":       model.TaskStatusCancelled,
			"completed_at": completedAt,
		}).Error; err != nil {
		observability.Error(ctx, "cancel persist failed", append(taskLogAttrs(&task), "error", err)...)
		return err
	}

	s.hub.SendToUser(task.UserID, &ws.Message{
		Type:    ws.MsgTypeTaskCancelled,
		TaskID:  taskID,
		TraceID: task.TraceID,
		Status:  string(model.TaskStatusCancelled),
	})

	if task.UpstreamTaskID != "" {
		switch task.Provider {
		case "runninghub", "runninghub_comfyui":
			go func(task model.Task) {
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				ctx = observability.ContextWithTraceID(ctx, task.TraceID)

				apiKey, baseURL, err := s.resolveChannel(&task)
				if err != nil {
					observability.Error(ctx, "cancel upstream resolve channel failed", append(taskLogAttrs(&task), "upstreamTaskId", task.UpstreamTaskID, "error", err)...)
					return
				}
				if rh, ok := s.providers["runninghub"].(*provider.RunningHubProvider); ok {
					if err := rh.CancelUpstreamTask(ctx, apiKey, baseURL, task.UpstreamTaskID); err != nil {
						observability.Error(ctx, "cancel upstream failed", append(taskLogAttrs(&task), "upstreamTaskId", task.UpstreamTaskID, "error", err)...)
						return
					}
					observability.Info(ctx, "cancel upstream completed", append(taskLogAttrs(&task), "upstreamTaskId", task.UpstreamTaskID)...)
				}
			}(task)
		case "comfyui":
			go func(task model.Task) {
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				ctx = observability.ContextWithTraceID(ctx, task.TraceID)

				apiKey, baseURL, err := s.resolveChannel(&task)
				if err != nil {
					observability.Error(ctx, "cancel upstream resolve channel failed", append(taskLogAttrs(&task), "upstreamTaskId", task.UpstreamTaskID, "error", err)...)
					return
				}
				if cp, ok := s.providers["comfyui"].(*provider.ComfyUIProvider); ok {
					if err := cp.CancelPrompt(ctx, apiKey, baseURL, task.UpstreamTaskID); err != nil {
						observability.Error(ctx, "cancel ComfyUI prompt failed", append(taskLogAttrs(&task), "upstreamTaskId", task.UpstreamTaskID, "error", err)...)
						return
					}
					observability.Info(ctx, "cancel ComfyUI prompt completed", append(taskLogAttrs(&task), "upstreamTaskId", task.UpstreamTaskID)...)
				}
			}(task)
		}
	}

	rtMs := taskRuntimeMs(&task, completedAt)
	observability.Info(ctx, "task cancelled", append(taskLogAttrs(&task), "runtimeMs", rtMs)...)
	s.writeAuditLog(&task, "task.cancelled", rtMs, nil)

	return nil
}

func (s *Scheduler) CreateTask(ctx context.Context, userID uint, taskType model.TaskType, providerName string,
	channelID uint, modelName, prompt, params string) (*model.Task, error) {

	if ctx == nil {
		ctx = context.Background()
	}

	taskID, _ := gonanoid.New(21)
	traceID := observability.TraceIDFromContext(ctx)

	task := &model.Task{
		TaskID:    taskID,
		TraceID:   traceID,
		UserID:    userID,
		Type:      taskType,
		Provider:  providerName,
		Status:    model.TaskStatusPending,
		ChannelID: channelID,
		Model:     modelName,
		Prompt:    prompt,
		Params:    params,
	}

	if err := s.db.WithContext(ctx).Create(task).Error; err != nil {
		observability.Error(ctx, "task create failed", append(taskLogAttrs(task), "error", err)...)
		return nil, err
	}
	observability.Info(ctx, "task created", taskLogAttrs(task)...)

	s.Enqueue(taskID)

	s.hub.SendToUser(userID, &ws.Message{
		Type:         ws.MsgTypeTaskStatus,
		TaskID:       taskID,
		TraceID:      task.TraceID,
		Status:       string(model.TaskStatusPending),
		Progress:     0,
		ProgressText: "排队中...",
	})

	return task, nil
}

func (s *Scheduler) run(ctx context.Context) {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		s.pollAndDispatch(ctx)
		select {
		case <-ctx.Done():
			return
		case <-s.notifyChan:
		case <-ticker.C:
		}
	}
}

func (s *Scheduler) pollAndDispatch(ctx context.Context) {
	var tasks []model.Task
	result := s.db.Where("status = ?", model.TaskStatusPending).
		Order("created_at ASC").
		Limit(50).
		Find(&tasks)
	if result.Error != nil {
		observability.Error(context.Background(), "poll pending tasks failed", "error", result.Error)
		return
	}
	if len(tasks) > 0 {
		observability.Debug(context.Background(), "polled pending tasks", "count", len(tasks))
	}

	for i := range tasks {
		if ctx.Err() != nil {
			return
		}
		task := &tasks[i]
		taskCtx := observability.ContextWithTraceID(ctx, task.TraceID)

		if _, ok := s.providers[task.Provider]; !ok {
			observability.Warn(taskCtx, "task rejected", append(taskLogAttrs(task), "reason", "unknownProvider")...)
			s.failTask(task, "unknown provider: "+task.Provider)
			continue
		}

		sem := s.semaphores[task.Provider]
		select {
		case sem <- struct{}{}:
			result := s.db.WithContext(taskCtx).Model(&model.Task{}).
				Where("task_id = ? AND status = ?", task.TaskID, model.TaskStatusPending).
				Update("status", model.TaskStatusQueued)
			if result.Error != nil {
				<-sem
				observability.Error(taskCtx, "task queue transition failed", append(taskLogAttrs(task), "error", result.Error)...)
				continue
			}
			if result.RowsAffected == 0 {
				<-sem
				observability.Debug(taskCtx, "task queue transition skipped", append(taskLogAttrs(task), "reason", "statusChanged")...)
				continue
			}
			observability.Info(taskCtx, "task queued", append(taskLogAttrs(task), "inFlight", len(sem), "concurrency", cap(sem))...)
			s.hub.SendToUser(task.UserID, &ws.Message{
				Type:         ws.MsgTypeTaskStatus,
				TaskID:       task.TaskID,
				TraceID:      task.TraceID,
				Status:       string(model.TaskStatusQueued),
				ProgressText: "等待执行...",
			})
			go s.dispatch(taskCtx, task, sem)
		default:
			observability.Debug(taskCtx, "provider busy", append(taskLogAttrs(task), "inFlight", len(sem), "concurrency", cap(sem))...)
		}
	}
}

func (s *Scheduler) dispatch(parentCtx context.Context, task *model.Task, sem chan struct{}) {
	defer func() { <-sem }()

	ctx, cancel := context.WithCancel(parentCtx)
	ctx = observability.ContextWithTraceID(ctx, task.TraceID)
	s.cancelMap.Store(task.TaskID, cancel)
	defer func() {
		cancel()
		s.cancelMap.Delete(task.TaskID)
	}()

	now := time.Now()
	task.StartedAt = &now
	if err := s.db.WithContext(ctx).Model(task).Updates(map[string]any{
		"status":     model.TaskStatusRunning,
		"started_at": now,
	}).Error; err != nil {
		observability.Error(ctx, "task running transition failed", append(taskLogAttrs(task), "error", err)...)
	}
	observability.Info(ctx, "task running", taskLogAttrs(task)...)

	s.hub.SendToUser(task.UserID, &ws.Message{
		Type:         ws.MsgTypeTaskStatus,
		TaskID:       task.TaskID,
		TraceID:      task.TraceID,
		Status:       string(model.TaskStatusRunning),
		Progress:     0,
		ProgressText: "开始执行...",
	})

	apiKey, baseURL, err := s.resolveChannel(task)
	if err != nil {
		observability.Error(ctx, "channel resolve failed", append(taskLogAttrs(task), "error", err)...)
		s.failTask(task, err.Error())
		return
	}
	observability.Debug(ctx, "channel resolved", append(taskLogAttrs(task), "hasBaseURL", baseURL != "")...)

	onProgress := func(progress int, text string) {
		updates := map[string]any{
			"progress":      progress,
			"progress_text": text,
		}
		if task.UpstreamTaskID != "" {
			updates["upstream_task_id"] = task.UpstreamTaskID
		}
		if err := s.db.WithContext(ctx).Model(task).Updates(updates).Error; err != nil {
			observability.Error(ctx, "task progress persist failed", append(taskLogAttrs(task), "progress", progress, "progressText", text, "upstreamTaskId", task.UpstreamTaskID, "error", err)...)
		}
		observability.Debug(ctx, "task progress", append(taskLogAttrs(task), "progress", progress, "progressText", text, "upstreamTaskId", task.UpstreamTaskID)...)
		s.hub.SendToUser(task.UserID, &ws.Message{
			Type:         ws.MsgTypeTaskStatus,
			TaskID:       task.TaskID,
			TraceID:      task.TraceID,
			Status:       string(model.TaskStatusRunning),
			Progress:     progress,
			ProgressText: text,
		})
	}

	p := s.providers[task.Provider]
	observability.Info(ctx, "task execute started", taskLogAttrs(task)...)
	result, err := p.Execute(ctx, task, apiKey, baseURL, s.fileStore, onProgress)
	if err != nil {
		if ctx.Err() != nil {
			observability.Warn(ctx, "task execute cancelled", append(taskLogAttrs(task), "runtimeMs", time.Since(now).Milliseconds())...)
			return
		}
		observability.Error(ctx, "task execute failed", append(taskLogAttrs(task), "runtimeMs", time.Since(now).Milliseconds(), "error", err)...)
		s.failTask(task, err.Error())
		return
	}

	task.UpstreamTaskID = result.UpstreamID
	resultJSON, _ := json.Marshal(result)
	fileIDs := make([]string, 0, len(result.Files))
	for _, f := range result.Files {
		fileIDs = append(fileIDs, f.FileID)
	}
	fileIDsJSON, _ := json.Marshal(fileIDs)

	completedAt := time.Now()
	rtMs := completedAt.Sub(now).Milliseconds()
	if err := s.db.WithContext(ctx).Model(task).Updates(map[string]any{
		"status":           model.TaskStatusSuccess,
		"progress":         100,
		"progress_text":    "完成",
		"result_data":      string(resultJSON),
		"file_ids":         string(fileIDsJSON),
		"upstream_task_id": task.UpstreamTaskID,
		"completed_at":     completedAt,
	}).Error; err != nil {
		observability.Error(ctx, "task success persist failed", append(taskLogAttrs(task), "upstreamTaskId", task.UpstreamTaskID, "runtimeMs", rtMs, "error", err)...)
	}
	observability.Info(ctx, "task completed", append(taskLogAttrs(task), "files", len(result.Files), "textBytes", len(result.Text), "upstreamTaskId", task.UpstreamTaskID, "runtimeMs", rtMs)...)

	s.hub.SendToUser(task.UserID, &ws.Message{
		Type:    ws.MsgTypeTaskCompleted,
		TaskID:  task.TaskID,
		TraceID: task.TraceID,
		Status:  string(model.TaskStatusSuccess),
		Result:  result,
	})

	s.writeAuditLog(task, "task.completed", rtMs, nil)
}

func (s *Scheduler) failTask(task *model.Task, errMsg string) {
	ctx := taskContext(task)
	completedAt := time.Now()
	rtMs := taskRuntimeMs(task, completedAt)
	if err := s.db.WithContext(ctx).Model(task).Updates(map[string]any{
		"status":        model.TaskStatusFailed,
		"error_message": errMsg,
		"completed_at":  completedAt,
	}).Error; err != nil {
		observability.Error(ctx, "task failure persist failed", append(taskLogAttrs(task), "runtimeMs", rtMs, "errorMessage", errMsg, "persistError", err)...)
	}
	observability.Error(ctx, "task failed", append(taskLogAttrs(task), "runtimeMs", rtMs, "errorMessage", errMsg)...)

	s.hub.SendToUser(task.UserID, &ws.Message{
		Type:    ws.MsgTypeTaskFailed,
		TaskID:  task.TaskID,
		TraceID: task.TraceID,
		Status:  string(model.TaskStatusFailed),
		Error:   errMsg,
	})

	s.writeAuditLog(task, "task.failed", rtMs, map[string]string{"error": errMsg})
}

func (s *Scheduler) resolveChannel(task *model.Task) (apiKey, baseURL string, err error) {
	if task.Provider == "runninghub" || task.Provider == "runninghub_comfyui" {
		var config model.RunningHubConfig
		if err := s.db.Where("user_id = ?", task.UserID).First(&config).Error; err != nil {
			return "", "", fmt.Errorf("no RunningHub API key configured")
		}
		if config.EncryptedAPIKey == "" {
			return "", "", fmt.Errorf("no RunningHub API key configured")
		}

		key, err := s.aesCrypto.Decrypt(config.EncryptedAPIKey)
		if err != nil || key == "" {
			return "", "", fmt.Errorf("no RunningHub API key configured")
		}

		return key, config.BaseURL, nil
	}

	if task.Provider == "comfyui" {
		var config model.ComfyUIConfig
		if err := s.db.Where("user_id = ?", task.UserID).First(&config).Error; err != nil {
			return "", "", fmt.Errorf("no ComfyUI server configured")
		}
		if config.ServerURL == "" {
			return "", "", fmt.Errorf("no ComfyUI server URL configured")
		}

		var key string
		if config.EncryptedAPIKey != "" {
			key, _ = s.aesCrypto.Decrypt(config.EncryptedAPIKey)
		}

		return key, config.ServerURL, nil
	}

	var channel model.ApiChannel
	if task.ChannelID > 0 {
		if err := s.db.Where("id = ? AND user_id = ?", task.ChannelID, task.UserID).First(&channel).Error; err != nil {
			return "", "", fmt.Errorf("channel not found")
		}
	} else {
		if err := s.db.Where("user_id = ? AND enabled = ?", task.UserID, true).First(&channel).Error; err != nil {
			return "", "", fmt.Errorf("no API channel configured")
		}
	}

	key, err := s.aesCrypto.Decrypt(channel.EncryptedAPIKey)
	if err != nil {
		return "", "", fmt.Errorf("failed to decrypt API key")
	}

	return key, channel.BaseURL, nil
}

func (s *Scheduler) recoverTasks() {
	result := s.db.Model(&model.Task{}).
		Where("status IN ?", []model.TaskStatus{model.TaskStatusRunning, model.TaskStatusQueued}).
		Update("status", model.TaskStatusPending)
	if result.Error != nil {
		observability.Error(context.Background(), "recover tasks failed", "error", result.Error)
		return
	}
	observability.Info(context.Background(), "recovered tasks", "count", result.RowsAffected)
}

func taskContext(task *model.Task) context.Context {
	if task == nil {
		return context.Background()
	}
	return observability.ContextWithTraceID(context.Background(), task.TraceID)
}

func taskLogAttrs(task *model.Task) []any {
	if task == nil {
		return []any{"taskId", "<nil>"}
	}
	return []any{
		"taskId", task.TaskID,
		"userId", task.UserID,
		"type", task.Type,
		"provider", task.Provider,
		"model", task.Model,
		"channelId", task.ChannelID,
	}
}

func taskRuntimeMs(task *model.Task, at time.Time) int64 {
	if task == nil || task.StartedAt == nil {
		return 0
	}
	return at.Sub(*task.StartedAt).Milliseconds()
}

func (s *Scheduler) writeAuditLog(task *model.Task, action string, responseTimeMs int64, detail any) {
	if task == nil {
		return
	}

	ctx := taskContext(task)

	var username string
	var user model.User
	if s.db.WithContext(ctx).First(&user, task.UserID).Error == nil {
		username = user.Username
	}

	var channelName string
	if task.ChannelID > 0 {
		var ch model.ApiChannel
		if s.db.WithContext(ctx).Select("name").First(&ch, task.ChannelID).Error == nil {
			channelName = ch.Name
		}
	}

	detailJSON := ""
	if detail != nil {
		data, _ := json.Marshal(detail)
		detailJSON = string(data)
	}

	if err := s.db.WithContext(ctx).Create(&model.AuditLog{
		TraceID:        task.TraceID,
		UserID:         task.UserID,
		Username:       username,
		Action:         action,
		Resource:       "task",
		ResourceID:     task.TaskID,
		Model:          task.Model,
		ChannelID:      task.ChannelID,
		ChannelName:    channelName,
		ResponseTimeMs: responseTimeMs,
		Detail:         detailJSON,
	}).Error; err != nil {
		observability.Error(ctx, "audit log write failed", append(taskLogAttrs(task), "action", action, "error", err)...)
	}
}
