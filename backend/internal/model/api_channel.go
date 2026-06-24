package model

import (
	"time"

	"gorm.io/gorm"
)

type ApiChannel struct {
	ID              uint           `gorm:"primaryKey" json:"id"`
	UserID          uint           `gorm:"index;not null" json:"userId"`
	Name            string         `gorm:"size:128" json:"name"`
	Provider        string         `gorm:"size:32;not null" json:"provider"`
	BaseURL         string         `gorm:"size:512;not null" json:"baseUrl"`
	EncryptedAPIKey string         `gorm:"size:1024;not null" json:"-"`
	APIFormat       string         `gorm:"size:16;default:openai" json:"apiFormat"`
	Models          string         `gorm:"type:text" json:"models"`
	MaxConcurrency  int            `gorm:"default:3" json:"maxConcurrency"`
	Enabled         bool           `gorm:"default:true" json:"enabled"`
	CreatedAt       time.Time      `json:"createdAt"`
	UpdatedAt       time.Time      `json:"updatedAt"`
	DeletedAt       gorm.DeletedAt `gorm:"index" json:"-"`
}
