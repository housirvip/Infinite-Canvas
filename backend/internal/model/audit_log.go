package model

import "time"

type AuditLog struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	UserID     uint      `gorm:"index;not null" json:"userId"`
	Username   string    `gorm:"size:64" json:"username"`
	Action     string    `gorm:"size:64;not null;index" json:"action"`
	Resource   string    `gorm:"size:64" json:"resource"`
	ResourceID string    `gorm:"size:64" json:"resourceId"`
	Detail     string    `gorm:"type:text" json:"detail,omitempty"`
	IP         string    `gorm:"size:64" json:"ip"`
	CreatedAt  time.Time `gorm:"index" json:"createdAt"`
}
