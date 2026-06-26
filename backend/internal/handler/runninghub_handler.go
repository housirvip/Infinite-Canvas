package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/infinite-canvas/backend/internal/crypto"
	"github.com/infinite-canvas/backend/internal/middleware"
	"github.com/infinite-canvas/backend/internal/model"
	"gorm.io/gorm"
)

type RunningHubHandler struct {
	db     *gorm.DB
	crypto *crypto.AESCrypto
}

func NewRunningHubHandler(db *gorm.DB, aesCrypto *crypto.AESCrypto) *RunningHubHandler {
	return &RunningHubHandler{db: db, crypto: aesCrypto}
}

type RunningHubParamPayload struct {
	NodeID       string   `json:"nodeId"`
	FieldName    string   `json:"fieldName"`
	Role         string   `json:"role"`
	Label        string   `json:"label"`
	DefaultValue string   `json:"defaultValue,omitempty"`
	Description  string   `json:"description,omitempty"`
	Order        int      `json:"order"`
	EnumOptions  []string `json:"enumOptions,omitempty"`
}

type RunningHubWorkflowPayload struct {
	ID           string                   `json:"id"`
	Name         string                   `json:"name"`
	WorkflowID   string                   `json:"workflowId"`
	OutputType   string                   `json:"outputType"`
	InstanceType string                   `json:"instanceType"`
	Params       []RunningHubParamPayload `json:"params"`
}

type UpdateRunningHubConfigRequest struct {
	APIKey           *string                      `json:"apiKey"`
	BaseURL          *string                      `json:"baseUrl"`
	Workflows        *[]RunningHubWorkflowPayload `json:"workflows"`
	ComfyUIWorkflows *[]RunningHubWorkflowPayload `json:"comfyuiWorkflows"`
}

type RunningHubConfigResponse struct {
	HasAPIKey        bool                        `json:"hasApiKey"`
	BaseURL          string                      `json:"baseUrl"`
	Workflows        []RunningHubWorkflowPayload `json:"workflows"`
	ComfyUIWorkflows []RunningHubWorkflowPayload `json:"comfyuiWorkflows"`
	UpdatedAt        string                      `json:"updatedAt,omitempty"`
}

func (h *RunningHubHandler) GetConfig(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var config model.RunningHubConfig
	if err := h.db.Where("user_id = ?", userID).First(&config).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, gin.H{"config": defaultRunningHubConfigResponse()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query RunningHub config"})
		return
	}

	resp, err := buildRunningHubConfigResponse(&config)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load RunningHub config"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"config": resp})
}

func (h *RunningHubHandler) UpdateConfig(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req UpdateRunningHubConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Workflows != nil && !isValidRunningHubWorkflows(*req.Workflows) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid RunningHub workflow"})
		return
	}

	if req.ComfyUIWorkflows != nil && !isValidRunningHubWorkflows(*req.ComfyUIWorkflows) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid RunningHub ComfyUI workflow"})
		return
	}

	if req.BaseURL != nil && !isValidRunningHubBaseURL(*req.BaseURL) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid RunningHub base URL"})
		return
	}

	var config model.RunningHubConfig
	result := h.db.Where("user_id = ?", userID).First(&config)
	if result.Error != nil && !errors.Is(result.Error, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query RunningHub config"})
		return
	}

	if req.APIKey == nil && req.BaseURL == nil && req.Workflows == nil && req.ComfyUIWorkflows == nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, gin.H{"config": defaultRunningHubConfigResponse()})
			return
		}

		resp, err := buildRunningHubConfigResponse(&config)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load RunningHub config"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"config": resp})
		return
	}

	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		config = model.RunningHubConfig{UserID: userID}

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

		if req.Workflows != nil {
			workflowsJSON, err := json.Marshal(*req.Workflows)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save RunningHub config"})
				return
			}
			config.Workflows = string(workflowsJSON)
		}

		if req.ComfyUIWorkflows != nil {
			cuWorkflowsJSON, err := json.Marshal(*req.ComfyUIWorkflows)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save RunningHub config"})
				return
			}
			config.ComfyUIWorkflows = string(cuWorkflowsJSON)
		}

		if req.BaseURL != nil {
			config.BaseURL = *req.BaseURL
		}

		if err := h.db.Create(&config).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save RunningHub config"})
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

		if req.Workflows != nil {
			workflowsJSON, err := json.Marshal(*req.Workflows)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update RunningHub config"})
				return
			}
			updates["workflows"] = string(workflowsJSON)
		}

		if req.ComfyUIWorkflows != nil {
			cuWorkflowsJSON, err := json.Marshal(*req.ComfyUIWorkflows)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update RunningHub config"})
				return
			}
			updates["comfyui_workflows"] = string(cuWorkflowsJSON)
		}

		if req.BaseURL != nil {
			updates["base_url"] = *req.BaseURL
		}

		if len(updates) > 0 {
			if err := h.db.Model(&config).Updates(updates).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update RunningHub config"})
				return
			}
			if err := h.db.Where("id = ?", config.ID).First(&config).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query RunningHub config"})
				return
			}
		}
	}

	resp, err := buildRunningHubConfigResponse(&config)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load RunningHub config"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"config": resp})
}

func defaultRunningHubConfigResponse() RunningHubConfigResponse {
	return RunningHubConfigResponse{
		HasAPIKey:        false,
		Workflows:        []RunningHubWorkflowPayload{},
		ComfyUIWorkflows: []RunningHubWorkflowPayload{},
	}
}

func buildRunningHubConfigResponse(config *model.RunningHubConfig) (RunningHubConfigResponse, error) {
	resp := RunningHubConfigResponse{
		HasAPIKey:        config.EncryptedAPIKey != "",
		BaseURL:          config.BaseURL,
		Workflows:        []RunningHubWorkflowPayload{},
		ComfyUIWorkflows: []RunningHubWorkflowPayload{},
	}

	if strings.TrimSpace(config.Workflows) != "" {
		if err := json.Unmarshal([]byte(config.Workflows), &resp.Workflows); err != nil {
			return RunningHubConfigResponse{}, err
		}
		if resp.Workflows == nil {
			resp.Workflows = []RunningHubWorkflowPayload{}
		}
	}

	if strings.TrimSpace(config.ComfyUIWorkflows) != "" {
		if err := json.Unmarshal([]byte(config.ComfyUIWorkflows), &resp.ComfyUIWorkflows); err != nil {
			return RunningHubConfigResponse{}, err
		}
		if resp.ComfyUIWorkflows == nil {
			resp.ComfyUIWorkflows = []RunningHubWorkflowPayload{}
		}
	}

	if !config.UpdatedAt.IsZero() {
		resp.UpdatedAt = config.UpdatedAt.Format("2006-01-02T15:04:05Z07:00")
	}

	return resp, nil
}

func isValidRunningHubWorkflows(workflows []RunningHubWorkflowPayload) bool {
	for _, workflow := range workflows {
		if strings.TrimSpace(workflow.ID) == "" || strings.TrimSpace(workflow.WorkflowID) == "" {
			return false
		}
		if !isValidRunningHubOutputType(workflow.OutputType) || !isValidRunningHubInstanceType(workflow.InstanceType) {
			return false
		}
		if workflow.Params == nil {
			return false
		}
		for _, param := range workflow.Params {
			if !isValidRunningHubParamRole(param.Role) {
				return false
			}
		}
	}

	return true
}

func isValidRunningHubOutputType(outputType string) bool {
	switch outputType {
	case "image", "video", "audio", "auto":
		return true
	default:
		return false
	}
}

func isValidRunningHubInstanceType(instanceType string) bool {
	switch instanceType {
	case "default", "plus":
		return true
	default:
		return false
	}
}

func isValidRunningHubParamRole(role string) bool {
	switch role {
	case "prompt", "image", "video", "audio", "boolean", "number", "string", "fixed", "ignore":
		return true
	default:
		return false
	}
}

func isValidRunningHubBaseURL(baseURL string) bool {
	switch baseURL {
	case "", "https://www.runninghub.cn", "https://www.runninghub.ai":
		return true
	default:
		return false
	}
}
