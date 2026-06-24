package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/infinite-canvas/backend/internal/middleware"
	"github.com/infinite-canvas/backend/internal/model"
	"github.com/infinite-canvas/backend/internal/scheduler"
	"gorm.io/gorm"
)

type TaskHandler struct {
	db        *gorm.DB
	scheduler *scheduler.Scheduler
}

func NewTaskHandler(db *gorm.DB, sched *scheduler.Scheduler) *TaskHandler {
	return &TaskHandler{db: db, scheduler: sched}
}

type CreateTaskRequest struct {
	Type       string `json:"type" binding:"required"`
	ChannelID  uint   `json:"channelId"`
	Model      string `json:"model"`
	Prompt     string `json:"prompt"`
	Params     any    `json:"params"`
	WorkflowID string `json:"workflowId,omitempty"`
}

func (h *TaskHandler) Create(c *gin.Context) {
	var req CreateTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := middleware.GetUserID(c)

	taskType := model.TaskType(req.Type)
	providerName := resolveProvider(taskType, req.Model)

	paramsJSON, _ := json.Marshal(req.Params)

	task, err := h.scheduler.CreateTask(userID, taskType, providerName,
		req.ChannelID, req.Model, req.Prompt, string(paramsJSON))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create task"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"task": task})
}

func (h *TaskHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	query := h.db.Where("user_id = ?", userID)

	if status := c.Query("status"); status != "" {
		query = query.Where("status = ?", status)
	}
	if taskType := c.Query("type"); taskType != "" {
		query = query.Where("type = ?", taskType)
	}

	var total int64
	query.Model(&model.Task{}).Count(&total)

	var tasks []model.Task
	query.Order("created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&tasks)

	c.JSON(http.StatusOK, gin.H{
		"tasks":    tasks,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
	})
}

func (h *TaskHandler) Get(c *gin.Context) {
	userID := middleware.GetUserID(c)
	taskID := c.Param("taskId")

	var task model.Task
	if err := h.db.Where("task_id = ? AND user_id = ?", taskID, userID).First(&task).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"task": task})
}

func (h *TaskHandler) Cancel(c *gin.Context) {
	userID := middleware.GetUserID(c)
	taskID := c.Param("taskId")

	var task model.Task
	if err := h.db.Where("task_id = ? AND user_id = ?", taskID, userID).First(&task).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}

	if task.IsTerminal() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "task already completed"})
		return
	}

	if err := h.scheduler.Cancel(taskID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to cancel task"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "task cancelled"})
}

func resolveProvider(taskType model.TaskType, modelName string) string {
	switch taskType {
	case model.TaskTypeImageGeneration, model.TaskTypeImageEdit:
		return "openai_image"
	case model.TaskTypeVideoGeneration:
		if isSeedanceModel(modelName) {
			return "seedance"
		}
		return "openai_video"
	case model.TaskTypeAudioGeneration:
		return "audio"
	case model.TaskTypeRunningHub:
		return "runninghub"
	default:
		return "openai_image"
	}
}

func isSeedanceModel(model string) bool {
	return len(model) >= 8 && (model[:8] == "seedance" || model[:8] == "Seedance")
}
