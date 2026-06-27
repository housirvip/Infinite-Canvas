package model

import "time"

type AuditLog struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	TraceID        string    `gorm:"size:128;index" json:"traceId,omitempty"`
	UserID         uint      `gorm:"index" json:"userId"`
	Username       string    `gorm:"size:64" json:"username"`
	Action         string    `gorm:"size:64;not null;index" json:"action"`
	Resource       string    `gorm:"size:64" json:"resource"`
	ResourceID     string    `gorm:"size:64" json:"resourceId"`
	Detail         string    `gorm:"type:text" json:"detail,omitempty"`
	IP             string    `gorm:"size:64" json:"ip"`
	Model          string    `gorm:"size:128" json:"model,omitempty"`
	ChannelID      uint      `json:"channelId,omitempty"`
	ChannelName    string    `gorm:"size:128" json:"channelName,omitempty"`
	APIFormat      string    `gorm:"size:32" json:"apiFormat,omitempty"`
	StatusCode     int       `json:"statusCode,omitempty"`
	ResponseTimeMs int64     `json:"responseTimeMs,omitempty"`
	CreatedAt      time.Time `gorm:"index" json:"createdAt"`
}
