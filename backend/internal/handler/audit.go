package handler

import (
	"context"

	"github.com/infinite-canvas/backend/internal/model"
	"github.com/infinite-canvas/backend/internal/observability"
	"gorm.io/gorm"
)

func writeAuditLog(ctx context.Context, db *gorm.DB, entry *model.AuditLog) {
	if ctx == nil {
		ctx = context.Background()
	}
	if entry.TraceID == "" {
		entry.TraceID = observability.TraceIDFromContext(ctx)
	}
	go func() {
		if err := db.WithContext(ctx).Create(entry).Error; err != nil {
			observability.Error(ctx, "audit log write failed",
				"action", entry.Action,
				"resource", entry.Resource,
				"resourceId", entry.ResourceID,
				"error", err,
			)
		}
	}()
}
