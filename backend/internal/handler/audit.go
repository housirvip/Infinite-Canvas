package handler

import (
	"log"

	"github.com/infinite-canvas/backend/internal/model"
	"gorm.io/gorm"
)

func writeAuditLog(db *gorm.DB, entry *model.AuditLog) {
	go func() {
		if err := db.Create(entry).Error; err != nil {
			log.Printf("failed to write audit log: %v", err)
		}
	}()
}
