package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/infinite-canvas/backend/internal/model"
	"gorm.io/gorm"
)

type AdminHandler struct {
	db *gorm.DB
}

func NewAdminHandler(db *gorm.DB) *AdminHandler {
	return &AdminHandler{db: db}
}

func (h *AdminHandler) ListAuditLogs(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "50"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}

	query := h.db.Model(&model.AuditLog{})
	if action := c.Query("action"); action != "" {
		query = query.Where("action = ?", action)
	}
	if userID := c.Query("userId"); userID != "" {
		query = query.Where("user_id = ?", userID)
	}
	if modelName := c.Query("model"); modelName != "" {
		query = query.Where("model = ?", modelName)
	}

	var total int64
	query.Count(&total)

	var logs []model.AuditLog
	query.Order("created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&logs)

	c.JSON(http.StatusOK, gin.H{
		"logs":     logs,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
	})
}

func (h *AdminHandler) ListUsers(c *gin.Context) {
	var users []model.User
	h.db.Order("created_at DESC").Find(&users)
	c.JSON(http.StatusOK, gin.H{"users": users})
}

type UpdateUserRequest struct {
	Role           *string `json:"role"`
	MaxConcurrency *int    `json:"maxConcurrency"`
}

func (h *AdminHandler) UpdateUser(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	var req UpdateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]any{}
	if req.Role != nil {
		if *req.Role != "user" && *req.Role != "admin" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "role must be 'user' or 'admin'"})
			return
		}
		updates["role"] = *req.Role
	}
	if req.MaxConcurrency != nil {
		updates["max_concurrency"] = *req.MaxConcurrency
	}

	if err := h.db.Model(&model.User{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update user"})
		return
	}

	var user model.User
	h.db.First(&user, id)
	c.JSON(http.StatusOK, gin.H{"user": user})
}
