package model

import (
	"time"

	"gorm.io/gorm"
)

type Asset struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	AssetID   string         `gorm:"uniqueIndex;size:32;not null" json:"assetId"`
	UserID    uint           `gorm:"index;not null" json:"userId"`
	Kind      string         `gorm:"size:16;not null" json:"kind"`
	Title     string         `gorm:"size:256" json:"title"`
	Tags      string         `gorm:"type:text" json:"tags"`
	Note      string         `gorm:"type:text" json:"note"`
	DataJSON  string         `gorm:"type:text" json:"data"`
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}
