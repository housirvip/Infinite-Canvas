package model

import "time"

type UserSettings struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"uniqueIndex;not null" json:"userId"`
	Settings  string    `gorm:"type:text" json:"settings"`
	UpdatedAt time.Time `json:"updatedAt"`
}
