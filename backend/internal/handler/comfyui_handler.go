package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/infinite-canvas/backend/internal/crypto"
	"github.com/infinite-canvas/backend/internal/middleware"
	"github.com/infinite-canvas/backend/internal/model"
	"gorm.io/gorm"
)

type ComfyUIHandler struct {
	db     *gorm.DB
	crypto *crypto.AESCrypto
}

func NewComfyUIHandler(db *gorm.DB, aesCrypto *crypto.AESCrypto) *ComfyUIHandler {
	return &ComfyUIHandler{db: db, crypto: aesCrypto}
}

type ComfyUIParamPayload struct {
	NodeID       string   `json:"nodeId"`
	FieldName    string   `json:"fieldName"`
	Role         string   `json:"role"`
	Label        string   `json:"label"`
	DefaultValue string   `json:"defaultValue,omitempty"`
	Description  string   `json:"description,omitempty"`
	Order        int      `json:"order"`
	EnumOptions  []string `json:"enumOptions,omitempty"`
}

type ComfyUIPresetPayload struct {
	ID           string                `json:"id"`
	Name         string                `json:"name"`
	WorkflowJSON string                `json:"workflowJson"`
	OutputType   string                `json:"outputType"`
	Params       []ComfyUIParamPayload `json:"params"`
}

type UpdateComfyUIConfigRequest struct {
	ServerURL *string                `json:"serverUrl"`
	APIKey    *string                `json:"apiKey"`
	Presets   *[]ComfyUIPresetPayload `json:"presets"`
}

type ComfyUIConfigResponse struct {
	HasAPIKey bool                  `json:"hasApiKey"`
	ServerURL string                `json:"serverUrl"`
	Presets   []ComfyUIPresetPayload `json:"presets"`
	UpdatedAt string                `json:"updatedAt,omitempty"`
}

func (h *ComfyUIHandler) GetConfig(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var config model.ComfyUIConfig
	if err := h.db.Where("user_id = ?", userID).First(&config).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, gin.H{"config": defaultComfyUIConfigResponse()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query ComfyUI config"})
		return
	}

	resp, err := buildComfyUIConfigResponse(&config)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load ComfyUI config"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"config": resp})
}

func (h *ComfyUIHandler) UpdateConfig(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req UpdateComfyUIConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Presets != nil && !isValidComfyUIPresets(*req.Presets) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ComfyUI preset"})
		return
	}

	if req.ServerURL != nil && !isValidComfyUIServerURL(strings.TrimSpace(*req.ServerURL)) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid server URL: must be http or https with a valid host"})
		return
	}

	var config model.ComfyUIConfig
	result := h.db.Where("user_id = ?", userID).First(&config)
	if result.Error != nil && !errors.Is(result.Error, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query ComfyUI config"})
		return
	}

	if req.APIKey == nil && req.ServerURL == nil && req.Presets == nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, gin.H{"config": defaultComfyUIConfigResponse()})
			return
		}
		resp, err := buildComfyUIConfigResponse(&config)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load ComfyUI config"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"config": resp})
		return
	}

	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		config = model.ComfyUIConfig{UserID: userID}

		if req.APIKey != nil {
			trimmedKey := strings.TrimSpace(*req.APIKey)
			if trimmedKey != "" {
				encrypted, err := h.crypto.Encrypt(trimmedKey)
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encrypt API key"})
					return
				}
				config.EncryptedAPIKey = encrypted
			}
		}

		if req.Presets != nil {
			presetsJSON, err := json.Marshal(*req.Presets)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save ComfyUI config"})
				return
			}
			config.Presets = string(presetsJSON)
		}

		if req.ServerURL != nil {
			config.ServerURL = strings.TrimSpace(*req.ServerURL)
		}

		if err := h.db.Create(&config).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save ComfyUI config"})
			return
		}
	} else {
		updates := map[string]any{}

		if req.APIKey != nil {
			trimmedKey := strings.TrimSpace(*req.APIKey)
			if trimmedKey == "" {
				updates["encrypted_api_key"] = ""
			} else {
				encrypted, err := h.crypto.Encrypt(trimmedKey)
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encrypt API key"})
					return
				}
				updates["encrypted_api_key"] = encrypted
			}
		}

		if req.Presets != nil {
			presetsJSON, err := json.Marshal(*req.Presets)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update ComfyUI config"})
				return
			}
			updates["presets"] = string(presetsJSON)
		}

		if req.ServerURL != nil {
			updates["server_url"] = strings.TrimSpace(*req.ServerURL)
		}

		if len(updates) > 0 {
			if err := h.db.Model(&config).Updates(updates).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update ComfyUI config"})
				return
			}
			if err := h.db.Where("id = ?", config.ID).First(&config).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query ComfyUI config"})
				return
			}
		}
	}

	resp, err := buildComfyUIConfigResponse(&config)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load ComfyUI config"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"config": resp})
}

func defaultComfyUIConfigResponse() ComfyUIConfigResponse {
	return ComfyUIConfigResponse{
		HasAPIKey: false,
		Presets:   []ComfyUIPresetPayload{},
	}
}

func buildComfyUIConfigResponse(config *model.ComfyUIConfig) (ComfyUIConfigResponse, error) {
	resp := ComfyUIConfigResponse{
		HasAPIKey: config.EncryptedAPIKey != "",
		ServerURL: config.ServerURL,
		Presets:   []ComfyUIPresetPayload{},
	}

	if strings.TrimSpace(config.Presets) != "" {
		if err := json.Unmarshal([]byte(config.Presets), &resp.Presets); err != nil {
			return ComfyUIConfigResponse{}, err
		}
		if resp.Presets == nil {
			resp.Presets = []ComfyUIPresetPayload{}
		}
	}

	if !config.UpdatedAt.IsZero() {
		resp.UpdatedAt = config.UpdatedAt.Format("2006-01-02T15:04:05Z07:00")
	}

	return resp, nil
}

func isValidComfyUIPresets(presets []ComfyUIPresetPayload) bool {
	for _, preset := range presets {
		if strings.TrimSpace(preset.ID) == "" || strings.TrimSpace(preset.Name) == "" {
			return false
		}
		if strings.TrimSpace(preset.WorkflowJSON) == "" {
			return false
		}
		if !isValidComfyUIOutputType(preset.OutputType) {
			return false
		}
		for _, param := range preset.Params {
			if strings.TrimSpace(param.NodeID) == "" || strings.TrimSpace(param.FieldName) == "" {
				return false
			}
			if !isValidComfyUIParamRole(param.Role) {
				return false
			}
		}
	}
	return true
}

func isValidComfyUIParamRole(role string) bool {
	switch role {
	case "prompt", "image", "video", "audio", "number", "string", "boolean", "fixed", "ignore":
		return true
	default:
		return false
	}
}

func isValidComfyUIOutputType(outputType string) bool {
	switch outputType {
	case "image", "video", "audio", "auto":
		return true
	default:
		return false
	}
}

func isValidComfyUIServerURL(rawURL string) bool {
	if rawURL == "" {
		return true
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	return u.Host != ""
}
