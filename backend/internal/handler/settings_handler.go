package handler

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/infinite-canvas/backend/internal/middleware"
	"github.com/infinite-canvas/backend/internal/model"
	"gorm.io/gorm"
)

type SettingsHandler struct {
	db *gorm.DB
}

func NewSettingsHandler(db *gorm.DB) *SettingsHandler {
	return &SettingsHandler{db: db}
}

func (h *SettingsHandler) Get(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var settings model.UserSettings
	if err := h.db.Where("user_id = ?", userID).First(&settings).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"settings": map[string]any{}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"settings": maskSettings(settings.Settings)})
}

func (h *SettingsHandler) Update(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var body struct {
		Settings json.RawMessage `json:"settings" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	raw := string(body.Settings)

	var settings model.UserSettings
	result := h.db.Where("user_id = ?", userID).First(&settings)

	if result.Error != nil {
		settings = model.UserSettings{
			UserID:   userID,
			Settings: raw,
		}
		if err := h.db.Create(&settings).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save settings"})
			return
		}
	} else {
		if err := h.db.Model(&settings).Update("settings", raw).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update settings"})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{"settings": maskSettings(raw)})
}

var sensitiveKeys = []string{"apiKey", "runninghubApiKey"}

func maskSettings(raw string) map[string]any {
	var m map[string]any
	if json.Unmarshal([]byte(raw), &m) != nil {
		return map[string]any{}
	}
	for _, key := range sensitiveKeys {
		delete(m, key)
	}
	return m
}
