package model

import "time"

type ComfyUIConfig struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	UserID          uint      `gorm:"uniqueIndex;not null" json:"userId"`
	ServerURL       string    `gorm:"size:256" json:"serverUrl"`
	EncryptedAPIKey string    `gorm:"size:1024" json:"-"`
	Presets         string    `gorm:"type:text" json:"presets"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}
