package model

import (
	"time"

	"gorm.io/gorm"
)

type TaskStatus string

const (
	TaskStatusPending   TaskStatus = "pending"
	TaskStatusQueued    TaskStatus = "queued"
	TaskStatusRunning   TaskStatus = "running"
	TaskStatusSuccess   TaskStatus = "success"
	TaskStatusFailed    TaskStatus = "failed"
	TaskStatusCancelled TaskStatus = "cancelled"
)

type TaskType string

const (
	TaskTypeImageGeneration   TaskType = "image_generation"
	TaskTypeImageEdit         TaskType = "image_edit"
	TaskTypeVideoGeneration   TaskType = "video_generation"
	TaskTypeAudioGeneration   TaskType = "audio_generation"
	TaskTypeRunningHub        TaskType = "runninghub"
	TaskTypeComfyUI           TaskType = "comfyui"
	TaskTypeRunningHubComfyUI TaskType = "runninghub_comfyui"
)

type Task struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	TaskID         string         `gorm:"uniqueIndex;size:32;not null" json:"taskId"`
	TraceID        string         `gorm:"size:128;index" json:"traceId,omitempty"`
	UserID         uint           `gorm:"index;not null" json:"userId"`
	Type           TaskType       `gorm:"size:32;not null" json:"type"`
	Provider       string         `gorm:"size:32;not null;index" json:"provider"`
	Status         TaskStatus     `gorm:"size:16;not null;default:pending;index" json:"status"`
	ChannelID      uint           `gorm:"index" json:"channelId"`
	Model          string         `gorm:"size:128" json:"model"`
	Prompt         string         `gorm:"type:text" json:"prompt"`
	Params         string         `gorm:"type:text" json:"params"`
	Progress       int            `gorm:"default:0" json:"progress"`
	ProgressText   string         `gorm:"size:256" json:"progressText"`
	ResultData     string         `gorm:"type:text" json:"resultData,omitempty"`
	ErrorMessage   string         `gorm:"type:text" json:"errorMessage,omitempty"`
	UpstreamTaskID string         `gorm:"size:128" json:"upstreamTaskId,omitempty"`
	FileIDs        string         `gorm:"type:text" json:"fileIds,omitempty"`
	StartedAt      *time.Time     `json:"startedAt,omitempty"`
	CompletedAt    *time.Time     `json:"completedAt,omitempty"`
	CreatedAt      time.Time      `json:"createdAt"`
	UpdatedAt      time.Time      `json:"updatedAt"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}

func (t *Task) IsTerminal() bool {
	return t.Status == TaskStatusSuccess || t.Status == TaskStatusFailed || t.Status == TaskStatusCancelled
}
