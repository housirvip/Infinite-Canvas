package model

import (
	"time"

	"gorm.io/gorm"
)

type User struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	Username       string         `gorm:"uniqueIndex;size:64;not null" json:"username"`
	DisplayName    string         `gorm:"size:128" json:"displayName"`
	PasswordHash   string         `gorm:"size:128;not null" json:"-"`
	Role           string         `gorm:"size:16;default:user" json:"role"`
	MaxConcurrency int            `gorm:"default:3" json:"maxConcurrency"`
	CreatedAt      time.Time      `json:"createdAt"`
	UpdatedAt      time.Time      `json:"updatedAt"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}
