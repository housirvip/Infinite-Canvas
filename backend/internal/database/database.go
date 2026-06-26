package database

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/infinite-canvas/backend/internal/config"
	"github.com/infinite-canvas/backend/internal/model"
	"gorm.io/driver/mysql"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func Open(cfg *config.DatabaseConfig, logLevel string) (*gorm.DB, error) {
	var dialector gorm.Dialector

	switch cfg.Driver {
	case "sqlite":
		if dir := filepath.Dir(cfg.DSN); dir != "." {
			os.MkdirAll(dir, 0755)
		}
		dialector = sqlite.Open(cfg.DSN)
	case "mysql":
		dialector = mysql.Open(cfg.DSN)
	default:
		return nil, fmt.Errorf("unsupported database driver: %s", cfg.Driver)
	}

	gormLogLevel := logger.Warn
	if logLevel == "debug" {
		gormLogLevel = logger.Info
	}

	db, err := gorm.Open(dialector, &gorm.Config{
		Logger: logger.Default.LogMode(gormLogLevel),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	if err := db.AutoMigrate(
		&model.User{},
		&model.ApiChannel{},
		&model.Task{},
		&model.AuditLog{},
		&model.UserSettings{},
		&model.RunningHubConfig{},
		&model.ComfyUIConfig{},
		&model.CanvasProject{},
		&model.Asset{},
	); err != nil {
		return nil, fmt.Errorf("failed to auto-migrate: %w", err)
	}

	return db, nil
}
