package model

import "time"

type RunningHubConfig struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	UserID          uint      `gorm:"uniqueIndex;not null" json:"userId"`
	EncryptedAPIKey string    `gorm:"size:1024" json:"-"`
	Workflows       string    `gorm:"type:text" json:"workflows"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}
