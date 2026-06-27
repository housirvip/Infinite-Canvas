package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	gonanoid "github.com/matoous/go-nanoid/v2"

	"github.com/infinite-canvas/backend/internal/config"
	"github.com/infinite-canvas/backend/internal/crypto"
	"github.com/infinite-canvas/backend/internal/model"
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
	s.recoverTasks()
	go s.run(ctx)
}

func (s *Scheduler) Enqueue(taskID string) {
	select {
	case s.notifyChan <- struct{}{}:
	default:
	}
}

func (s *Scheduler) Cancel(taskID string) error {
	if cancel, ok := s.cancelMap.Load(taskID); ok {
		cancel.(context.CancelFunc)()
	}

	var task model.Task
	if err := s.db.Where("task_id = ?", taskID).First(&task).Error; err != nil {
		return err
	}

	completedAt := time.Now()
	if err := s.db.Model(&model.Task{}).Where("task_id = ?", taskID).
		Updates(map[string]any{
			"status":       model.TaskStatusCancelled,
			"completed_at": completedAt,
		}).Error; err != nil {
		return err
	}

	s.hub.SendToUser(task.UserID, &ws.Message{
		Type:   ws.MsgTypeTaskCancelled,
		TaskID: taskID,
		Status: string(model.TaskStatusCancelled),
	})

	if task.UpstreamTaskID != "" {
		switch task.Provider {
		case "runninghub", "runninghub_comfyui":
			go func() {
				apiKey, baseURL, err := s.resolveChannel(&task)
				if err != nil {
					log.Printf("scheduler: cancel upstream: resolve channel failed: %v", err)
					return
				}
				if rh, ok := s.providers["runninghub"].(*provider.RunningHubProvider); ok {
					if err := rh.CancelUpstreamTask(apiKey, baseURL, task.UpstreamTaskID); err != nil {
						log.Printf("scheduler: cancel upstream task %s failed: %v", task.UpstreamTaskID, err)
					}
				}
			}()
		case "comfyui":
			go func() {
				apiKey, baseURL, err := s.resolveChannel(&task)
				if err != nil {
					log.Printf("scheduler: cancel upstream: resolve channel failed: %v", err)
					return
				}
				if cp, ok := s.providers["comfyui"].(*provider.ComfyUIProvider); ok {
					ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
					defer cancel()
					if err := cp.CancelPrompt(ctx, apiKey, baseURL, task.UpstreamTaskID); err != nil {
						log.Printf("scheduler: cancel ComfyUI prompt %s failed: %v", task.UpstreamTaskID, err)
					}
				}
			}()
		}
	}

	var rtMs int64
	if task.StartedAt != nil {
		rtMs = completedAt.Sub(*task.StartedAt).Milliseconds()
	}
	s.writeAuditLog(&task, "task.cancelled", rtMs, nil)

	return nil
}

func (s *Scheduler) CreateTask(userID uint, taskType model.TaskType, providerName string,
	channelID uint, modelName, prompt, params string) (*model.Task, error) {

	taskID, _ := gonanoid.New(21)

	task := &model.Task{
		TaskID:    taskID,
		UserID:    userID,
		Type:      taskType,
		Provider:  providerName,
		Status:    model.TaskStatusPending,
		ChannelID: channelID,
		Model:     modelName,
		Prompt:    prompt,
		Params:    params,
	}

	if err := s.db.Create(task).Error; err != nil {
		return nil, err
	}

	s.Enqueue(taskID)

	s.hub.SendToUser(userID, &ws.Message{
		Type:         ws.MsgTypeTaskStatus,
		TaskID:       taskID,
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
	s.db.Where("status = ?", model.TaskStatusPending).
		Order("created_at ASC").
		Limit(50).
		Find(&tasks)

	for i := range tasks {
		if ctx.Err() != nil {
			return
		}
		task := &tasks[i]

		_, ok := s.providers[task.Provider]
		if !ok {
			s.failTask(task, "unknown provider: "+task.Provider)
			continue
		}

		sem := s.semaphores[task.Provider]
		select {
		case sem <- struct{}{}:
			result := s.db.Model(&model.Task{}).
				Where("task_id = ? AND status = ?", task.TaskID, model.TaskStatusPending).
				Update("status", model.TaskStatusQueued)
			if result.RowsAffected == 0 {
				<-sem
				continue
			}
			s.hub.SendToUser(task.UserID, &ws.Message{
				Type:         ws.MsgTypeTaskStatus,
				TaskID:       task.TaskID,
				Status:       string(model.TaskStatusQueued),
				ProgressText: "等待执行...",
			})
			go s.dispatch(ctx, task, sem)
		default:
		}
	}
}

func (s *Scheduler) dispatch(parentCtx context.Context, task *model.Task, sem chan struct{}) {
	defer func() { <-sem }()

	ctx, cancel := context.WithCancel(parentCtx)
	s.cancelMap.Store(task.TaskID, cancel)
	defer func() {
		cancel()
		s.cancelMap.Delete(task.TaskID)
	}()

	now := time.Now()
	task.StartedAt = &now
	s.db.Model(task).Updates(map[string]any{
		"status":     model.TaskStatusRunning,
		"started_at": now,
	})

	s.hub.SendToUser(task.UserID, &ws.Message{
		Type:         ws.MsgTypeTaskStatus,
		TaskID:       task.TaskID,
		Status:       string(model.TaskStatusRunning),
		Progress:     0,
		ProgressText: "开始执行...",
	})

	apiKey, baseURL, err := s.resolveChannel(task)
	if err != nil {
		s.failTask(task, err.Error())
		return
	}

	onProgress := func(progress int, text string) {
		updates := map[string]any{
			"progress":      progress,
			"progress_text": text,
		}
		if task.UpstreamTaskID != "" {
			updates["upstream_task_id"] = task.UpstreamTaskID
		}
		s.db.Model(task).Updates(updates)
		s.hub.SendToUser(task.UserID, &ws.Message{
			Type:         ws.MsgTypeTaskStatus,
			TaskID:       task.TaskID,
			Status:       string(model.TaskStatusRunning),
			Progress:     progress,
			ProgressText: text,
		})
	}

	p := s.providers[task.Provider]
	result, err := p.Execute(ctx, task, apiKey, baseURL, s.fileStore, onProgress)
	if err != nil {
		if ctx.Err() != nil {
			return
		}
		s.failTask(task, err.Error())
		return
	}

	resultJSON, _ := json.Marshal(result)
	fileIDs := make([]string, 0, len(result.Files))
	for _, f := range result.Files {
		fileIDs = append(fileIDs, f.FileID)
	}
	fileIDsJSON, _ := json.Marshal(fileIDs)

	completedAt := time.Now()
	s.db.Model(task).Updates(map[string]any{
		"status":           model.TaskStatusSuccess,
		"progress":         100,
		"progress_text":    "完成",
		"result_data":      string(resultJSON),
		"file_ids":         string(fileIDsJSON),
		"upstream_task_id": result.UpstreamID,
		"completed_at":     completedAt,
	})

	s.hub.SendToUser(task.UserID, &ws.Message{
		Type:   ws.MsgTypeTaskCompleted,
		TaskID: task.TaskID,
		Status: string(model.TaskStatusSuccess),
		Result: result,
	})

	s.writeAuditLog(task, "task.completed", completedAt.Sub(now).Milliseconds(), nil)
}

func (s *Scheduler) failTask(task *model.Task, errMsg string) {
	completedAt := time.Now()
	s.db.Model(task).Updates(map[string]any{
		"status":        model.TaskStatusFailed,
		"error_message": errMsg,
		"completed_at":  completedAt,
	})

	s.hub.SendToUser(task.UserID, &ws.Message{
		Type:   ws.MsgTypeTaskFailed,
		TaskID: task.TaskID,
		Status: string(model.TaskStatusFailed),
		Error:  errMsg,
	})

	var rtMs int64
	if task.StartedAt != nil {
		rtMs = completedAt.Sub(*task.StartedAt).Milliseconds()
	}
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
	if result.RowsAffected > 0 {
		log.Printf("scheduler: recovered %d tasks", result.RowsAffected)
	}
}

func (s *Scheduler) writeAuditLog(task *model.Task, action string, responseTimeMs int64, detail any) {
	var username string
	var user model.User
	if s.db.First(&user, task.UserID).Error == nil {
		username = user.Username
	}

	var channelName string
	if task.ChannelID > 0 {
		var ch model.ApiChannel
		if s.db.Select("name").First(&ch, task.ChannelID).Error == nil {
			channelName = ch.Name
		}
	}

	detailJSON := ""
	if detail != nil {
		data, _ := json.Marshal(detail)
		detailJSON = string(data)
	}

	s.db.Create(&model.AuditLog{
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
	})
}
