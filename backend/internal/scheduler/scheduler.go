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
	taskChan   chan string
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
		taskChan:   make(chan string, cfg.QueueSize),
		fileStore:  fileStore,
		aesCrypto:  aesCrypto,
		cfg:        cfg,
	}

	providerList := []provider.Provider{
		provider.NewOpenAIImageProvider(),
		provider.NewOpenAIVideoProvider(),
		provider.NewSeedanceVideoProvider(),
		provider.NewRunningHubProvider(),
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
	case s.taskChan <- taskID:
	default:
		log.Printf("scheduler: queue full, dropping task %s", taskID)
		s.db.Model(&model.Task{}).Where("task_id = ?", taskID).
			Updates(map[string]any{
				"status":        model.TaskStatusFailed,
				"error_message": "任务队列已满，请稍后重试",
			})
	}
}

func (s *Scheduler) Cancel(taskID string) error {
	if cancel, ok := s.cancelMap.Load(taskID); ok {
		cancel.(context.CancelFunc)()
	}
	return s.db.Model(&model.Task{}).Where("task_id = ?", taskID).
		Updates(map[string]any{
			"status":       model.TaskStatusCancelled,
			"completed_at": time.Now(),
		}).Error
}

func (s *Scheduler) CreateTask(userID uint, taskType model.TaskType, providerName string,
	channelID uint, modelName, prompt, params string) (*model.Task, error) {

	taskID, _ := gonanoid.New(21)

	task := &model.Task{
		TaskID:   taskID,
		UserID:   userID,
		Type:     taskType,
		Provider: providerName,
		Status:   model.TaskStatusPending,
		ChannelID: channelID,
		Model:    modelName,
		Prompt:   prompt,
		Params:   params,
	}

	if err := s.db.Create(task).Error; err != nil {
		return nil, err
	}

	s.Enqueue(taskID)

	s.hub.SendToUser(userID, &ws.Message{
		Type:         ws.MsgTypeTaskStatus,
		TaskID:       taskID,
		Status:       string(model.TaskStatusQueued),
		Progress:     0,
		ProgressText: "排队中...",
	})

	return task, nil
}

func (s *Scheduler) run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case taskID := <-s.taskChan:
			go s.dispatch(ctx, taskID)
		}
	}
}

func (s *Scheduler) dispatch(parentCtx context.Context, taskID string) {
	var task model.Task
	if err := s.db.Where("task_id = ?", taskID).First(&task).Error; err != nil {
		log.Printf("scheduler: task %s not found: %v", taskID, err)
		return
	}

	if task.IsTerminal() {
		return
	}

	p, ok := s.providers[task.Provider]
	if !ok {
		s.failTask(&task, "unknown provider: "+task.Provider)
		return
	}

	sem := s.semaphores[task.Provider]

	s.db.Model(&task).Update("status", model.TaskStatusQueued)
	s.hub.SendToUser(task.UserID, &ws.Message{
		Type:         ws.MsgTypeTaskStatus,
		TaskID:       task.TaskID,
		Status:       string(model.TaskStatusQueued),
		ProgressText: "等待执行槽位...",
	})

	select {
	case sem <- struct{}{}:
	case <-parentCtx.Done():
		return
	}
	defer func() { <-sem }()

	ctx, cancel := context.WithCancel(parentCtx)
	s.cancelMap.Store(task.TaskID, cancel)
	defer func() {
		cancel()
		s.cancelMap.Delete(task.TaskID)
	}()

	now := time.Now()
	s.db.Model(&task).Updates(map[string]any{
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

	apiKey, baseURL, err := s.resolveChannel(&task)
	if err != nil {
		s.failTask(&task, err.Error())
		return
	}

	onProgress := func(progress int, text string) {
		s.db.Model(&task).Updates(map[string]any{
			"progress":      progress,
			"progress_text": text,
		})
		s.hub.SendToUser(task.UserID, &ws.Message{
			Type:         ws.MsgTypeTaskStatus,
			TaskID:       task.TaskID,
			Status:       string(model.TaskStatusRunning),
			Progress:     progress,
			ProgressText: text,
		})
	}

	result, err := p.Execute(ctx, &task, apiKey, baseURL, s.fileStore, onProgress)
	if err != nil {
		if ctx.Err() != nil {
			return
		}
		s.failTask(&task, err.Error())
		return
	}

	resultJSON, _ := json.Marshal(result)
	fileIDs := make([]string, 0, len(result.Files))
	for _, f := range result.Files {
		fileIDs = append(fileIDs, f.FileID)
	}
	fileIDsJSON, _ := json.Marshal(fileIDs)

	completedAt := time.Now()
	s.db.Model(&task).Updates(map[string]any{
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

	s.writeAuditLog(task.UserID, "task.completed", "task", task.TaskID, nil)
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

	s.writeAuditLog(task.UserID, "task.failed", "task", task.TaskID, map[string]string{"error": errMsg})
}

func (s *Scheduler) resolveChannel(task *model.Task) (apiKey, baseURL string, err error) {
	if task.Provider == "runninghub" {
		var settings model.UserSettings
		if err := s.db.Where("user_id = ?", task.UserID).First(&settings).Error; err != nil {
			return "", "", fmt.Errorf("no RunningHub API key configured")
		}
		var m map[string]any
		if json.Unmarshal([]byte(settings.Settings), &m) != nil {
			return "", "", fmt.Errorf("no RunningHub API key configured")
		}
		key, _ := m["runninghubApiKey"].(string)
		if key == "" {
			return "", "", fmt.Errorf("no RunningHub API key configured")
		}
		return key, "", nil
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
	var tasks []model.Task
	s.db.Where("status IN ?", []model.TaskStatus{model.TaskStatusRunning, model.TaskStatusQueued}).Find(&tasks)

	for _, task := range tasks {
		s.db.Model(&task).Update("status", model.TaskStatusPending)
		s.Enqueue(task.TaskID)
		log.Printf("scheduler: recovered task %s", task.TaskID)
	}
}

func (s *Scheduler) writeAuditLog(userID uint, action, resource, resourceID string, detail any) {
	var username string
	var user model.User
	if s.db.First(&user, userID).Error == nil {
		username = user.Username
	}

	detailJSON := ""
	if detail != nil {
		data, _ := json.Marshal(detail)
		detailJSON = string(data)
	}

	s.db.Create(&model.AuditLog{
		UserID:     userID,
		Username:   username,
		Action:     action,
		Resource:   resource,
		ResourceID: resourceID,
		Detail:     detailJSON,
	})
}
