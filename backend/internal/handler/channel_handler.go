package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/infinite-canvas/backend/internal/crypto"
	"github.com/infinite-canvas/backend/internal/middleware"
	"github.com/infinite-canvas/backend/internal/model"
	"github.com/infinite-canvas/backend/internal/observability"
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
	Provider       string   `json:"provider"`
	BaseURL        string   `json:"baseUrl" binding:"required"`
	APIKey         string   `json:"apiKey"`
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

	var encrypted string
	if req.APIKey != "" {
		var err error
		encrypted, err = h.crypto.Encrypt(req.APIKey)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encrypt API key"})
			return
		}
	}

	apiFormat := req.APIFormat
	if apiFormat == "" {
		apiFormat = "openai-completion"
	}

	provider := req.Provider
	if provider == "" {
		provider = apiFormat
	}

	maxConcurrency := req.MaxConcurrency
	if maxConcurrency <= 0 {
		maxConcurrency = 3
	}

	modelsJSON, _ := json.Marshal(req.Models)

	channel := model.ApiChannel{
		UserID:          userID,
		Name:            req.Name,
		Provider:        provider,
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

	writeAuditLog(c.Request.Context(), h.db, &model.AuditLog{
		UserID:     userID,
		Action:     "channel.create",
		Resource:   "channel",
		ResourceID: fmt.Sprintf("%d", channel.ID),
		Detail:     channel.Name,
		IP:         c.ClientIP(),
	})

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

	writeAuditLog(c.Request.Context(), h.db, &model.AuditLog{
		UserID:     userID,
		Action:     "channel.update",
		Resource:   "channel",
		ResourceID: fmt.Sprintf("%d", id),
		IP:         c.ClientIP(),
	})

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

	writeAuditLog(c.Request.Context(), h.db, &model.AuditLog{
		UserID:     userID,
		Action:     "channel.delete",
		Resource:   "channel",
		ResourceID: fmt.Sprintf("%d", id),
		IP:         c.ClientIP(),
	})

	c.JSON(http.StatusOK, gin.H{"message": "channel deleted"})
}

func (h *ChannelHandler) ListModels(c *gin.Context) {
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

	apiKey, err := h.crypto.Decrypt(channel.EncryptedAPIKey)
	if err != nil || apiKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "channel has no API key configured"})
		return
	}

	apiFormat := channel.APIFormat
	if apiFormat == "" || apiFormat == "openai" {
		apiFormat = "openai-completion"
	}

	var upstreamURL string
	var req *http.Request
	var reqErr error

	baseURL := strings.TrimRight(channel.BaseURL, "/")
	switch apiFormat {
	case "gemini":
		if !strings.HasSuffix(strings.ToLower(baseURL), "/v1beta") && !strings.HasSuffix(strings.ToLower(baseURL), "/v1") {
			baseURL += "/v1beta"
		}
		upstreamURL = baseURL + "/models"
		req, reqErr = http.NewRequestWithContext(c.Request.Context(), http.MethodGet, upstreamURL, nil)
		if reqErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid upstream URL"})
			return
		}
		req.Header.Set("x-goog-api-key", apiKey)
	case "anthropic":
		if baseURL == "" {
			baseURL = "https://api.anthropic.com"
		}
		upstreamURL = baseURL + "/v1/models"
		req, reqErr = http.NewRequestWithContext(c.Request.Context(), http.MethodGet, upstreamURL, nil)
		if reqErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid upstream URL"})
			return
		}
		req.Header.Set("anthropic-version", "2023-06-01")
		req.Header.Set("x-api-key", apiKey)
	default:
		if !strings.HasSuffix(strings.ToLower(baseURL), "/v1") {
			baseURL += "/v1"
		}
		upstreamURL = baseURL + "/models"
		req, reqErr = http.NewRequestWithContext(c.Request.Context(), http.MethodGet, upstreamURL, nil)
		if reqErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid upstream URL"})
			return
		}
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	if traceID := observability.TraceIDFromContext(c.Request.Context()); traceID != "" {
		req.Header.Set(observability.HeaderTraceID, traceID)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to fetch models from upstream"})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		c.JSON(resp.StatusCode, gin.H{"error": fmt.Sprintf("upstream returned %d", resp.StatusCode)})
		return
	}

	var models []string
	if apiFormat == "gemini" {
		var geminiResp struct {
			Models []struct {
				Name string `json:"name"`
			} `json:"models"`
		}
		if json.Unmarshal(body, &geminiResp) == nil {
			for _, m := range geminiResp.Models {
				name := strings.TrimPrefix(m.Name, "models/")
				if name != "" {
					models = append(models, name)
				}
			}
		}
	} else {
		var openaiResp struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if json.Unmarshal(body, &openaiResp) == nil {
			for _, m := range openaiResp.Data {
				if m.ID != "" {
					models = append(models, m.ID)
				}
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"models": models})
}
