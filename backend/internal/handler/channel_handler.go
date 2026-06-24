package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/infinite-canvas/backend/internal/crypto"
	"github.com/infinite-canvas/backend/internal/middleware"
	"github.com/infinite-canvas/backend/internal/model"
	"gorm.io/gorm"
)

type ChannelHandler struct {
	db     *gorm.DB
	crypto *crypto.AESCrypto
}

func NewChannelHandler(db *gorm.DB, aesCrypto *crypto.AESCrypto) *ChannelHandler {
	return &ChannelHandler{db: db, crypto: aesCrypto}
}

type CreateChannelRequest struct {
	Name           string   `json:"name" binding:"required"`
	Provider       string   `json:"provider" binding:"required"`
	BaseURL        string   `json:"baseUrl" binding:"required"`
	APIKey         string   `json:"apiKey" binding:"required"`
	APIFormat      string   `json:"apiFormat"`
	Models         []string `json:"models"`
	MaxConcurrency int      `json:"maxConcurrency"`
}

type UpdateChannelRequest struct {
	Name           *string  `json:"name"`
	BaseURL        *string  `json:"baseUrl"`
	APIKey         *string  `json:"apiKey"`
	APIFormat      *string  `json:"apiFormat"`
	Models         []string `json:"models"`
	MaxConcurrency *int     `json:"maxConcurrency"`
	Enabled        *bool    `json:"enabled"`
}

type ChannelResponse struct {
	model.ApiChannel
	HasAPIKey bool `json:"hasApiKey"`
}

func (h *ChannelHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var channels []model.ApiChannel
	if err := h.db.Where("user_id = ?", userID).Find(&channels).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query channels"})
		return
	}

	resp := make([]ChannelResponse, len(channels))
	for i, ch := range channels {
		resp[i] = ChannelResponse{
			ApiChannel: ch,
			HasAPIKey:  ch.EncryptedAPIKey != "",
		}
	}

	c.JSON(http.StatusOK, gin.H{"channels": resp})
}

func (h *ChannelHandler) Create(c *gin.Context) {
	var req CreateChannelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := middleware.GetUserID(c)

	encrypted, err := h.crypto.Encrypt(req.APIKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encrypt API key"})
		return
	}

	apiFormat := req.APIFormat
	if apiFormat == "" {
		apiFormat = "openai"
	}

	maxConcurrency := req.MaxConcurrency
	if maxConcurrency <= 0 {
		maxConcurrency = 3
	}

	modelsJSON, _ := json.Marshal(req.Models)

	channel := model.ApiChannel{
		UserID:          userID,
		Name:            req.Name,
		Provider:        req.Provider,
		BaseURL:         req.BaseURL,
		EncryptedAPIKey: encrypted,
		APIFormat:       apiFormat,
		Models:          string(modelsJSON),
		MaxConcurrency:  maxConcurrency,
		Enabled:         true,
	}

	if err := h.db.Create(&channel).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create channel"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"channel": ChannelResponse{
			ApiChannel: channel,
			HasAPIKey:  true,
		},
	})
}

func (h *ChannelHandler) Update(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid channel id"})
		return
	}

	userID := middleware.GetUserID(c)

	var channel model.ApiChannel
	if err := h.db.Where("id = ? AND user_id = ?", id, userID).First(&channel).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "channel not found"})
		return
	}

	var req UpdateChannelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]any{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.BaseURL != nil {
		updates["base_url"] = *req.BaseURL
	}
	if req.APIKey != nil {
		encrypted, err := h.crypto.Encrypt(*req.APIKey)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encrypt API key"})
			return
		}
		updates["encrypted_api_key"] = encrypted
	}
	if req.APIFormat != nil {
		updates["api_format"] = *req.APIFormat
	}
	if req.Models != nil {
		modelsJSON, _ := json.Marshal(req.Models)
		updates["models"] = string(modelsJSON)
	}
	if req.MaxConcurrency != nil {
		updates["max_concurrency"] = *req.MaxConcurrency
	}
	if req.Enabled != nil {
		updates["enabled"] = *req.Enabled
	}

	if err := h.db.Model(&channel).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update channel"})
		return
	}

	h.db.First(&channel, id)
	c.JSON(http.StatusOK, gin.H{
		"channel": ChannelResponse{
			ApiChannel: channel,
			HasAPIKey:  channel.EncryptedAPIKey != "",
		},
	})
}

func (h *ChannelHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid channel id"})
		return
	}

	userID := middleware.GetUserID(c)

	result := h.db.Where("id = ? AND user_id = ?", id, userID).Delete(&model.ApiChannel{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "channel not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "channel deleted"})
}
