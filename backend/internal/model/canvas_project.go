package model

import (
	"time"

	"gorm.io/gorm"
)

type CanvasProject struct {
	ID               uint           `gorm:"primaryKey" json:"id"`
	ProjectID        string         `gorm:"uniqueIndex;size:32;not null" json:"projectId"`
	UserID           uint           `gorm:"index;not null" json:"userId"`
	Title            string         `gorm:"size:256" json:"title"`
	BackgroundMode   string         `gorm:"size:16;default:lines" json:"backgroundMode"`
	ShowImageInfo    bool           `gorm:"default:false" json:"showImageInfo"`
	ViewportX        float64        `json:"viewportX"`
	ViewportY        float64        `json:"viewportY"`
	ViewportK        float64        `gorm:"default:1" json:"viewportK"`
	NodesJSON        string         `gorm:"type:mediumtext" json:"-"`
	ConnectionsJSON  string         `gorm:"type:mediumtext" json:"-"`
	ChatSessionsJSON string         `gorm:"type:mediumtext" json:"-"`
	ActiveChatID     string         `gorm:"size:32" json:"activeChatId"`
	CreatedAt        time.Time      `json:"createdAt"`
	UpdatedAt        time.Time      `json:"updatedAt"`
	DeletedAt        gorm.DeletedAt `gorm:"index" json:"-"`
}
