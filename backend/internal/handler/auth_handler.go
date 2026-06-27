package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/infinite-canvas/backend/internal/auth"
	"github.com/infinite-canvas/backend/internal/middleware"
	"github.com/infinite-canvas/backend/internal/model"
	"gorm.io/gorm"
)

type AuthHandler struct {
	db     *gorm.DB
	jwtMgr *auth.JWTManager
}

func NewAuthHandler(db *gorm.DB, jwtMgr *auth.JWTManager) *AuthHandler {
	return &AuthHandler{db: db, jwtMgr: jwtMgr}
}

type RegisterRequest struct {
	Username    string `json:"username" binding:"required,min=3,max=64"`
	Password    string `json:"password" binding:"required,min=6,max=128"`
	DisplayName string `json:"displayName"`
}

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refreshToken" binding:"required"`
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var count int64
	h.db.Model(&model.User{}).Where("username = ?", req.Username).Count(&count)
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "username already exists"})
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}

	displayName := req.DisplayName
	if displayName == "" {
		displayName = req.Username
	}

	user := model.User{
		Username:       req.Username,
		DisplayName:    displayName,
		PasswordHash:   hash,
		Role:           "user",
		MaxConcurrency: 3,
	}

	if err := h.db.Create(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create user"})
		return
	}

	tokens, err := h.jwtMgr.GenerateTokenPair(user.ID, user.Username, user.Role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"user":   user,
		"tokens": tokens,
	})

	writeAuditLog(c.Request.Context(), h.db, &model.AuditLog{
		UserID:   user.ID,
		Username: user.Username,
		Action:   "user.register",
		Resource: "user",
		IP:       c.ClientIP(),
	})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user model.User
	if err := h.db.Where("username = ?", req.Username).First(&user).Error; err != nil {
		writeAuditLog(c.Request.Context(), h.db, &model.AuditLog{
			Username: req.Username,
			Action:   "user.login_failed",
			Resource: "user",
			Detail:   "invalid username",
			IP:       c.ClientIP(),
		})
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid username or password"})
		return
	}

	if !auth.CheckPassword(user.PasswordHash, req.Password) {
		writeAuditLog(c.Request.Context(), h.db, &model.AuditLog{
			UserID:   user.ID,
			Username: user.Username,
			Action:   "user.login_failed",
			Resource: "user",
			Detail:   "wrong password",
			IP:       c.ClientIP(),
		})
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid username or password"})
		return
	}

	tokens, err := h.jwtMgr.GenerateTokenPair(user.ID, user.Username, user.Role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"user":   user,
		"tokens": tokens,
	})

	writeAuditLog(c.Request.Context(), h.db, &model.AuditLog{
		UserID:   user.ID,
		Username: user.Username,
		Action:   "user.login",
		Resource: "user",
		IP:       c.ClientIP(),
	})
}

func (h *AuthHandler) Refresh(c *gin.Context) {
	var req RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	claims, err := h.jwtMgr.ValidateToken(req.RefreshToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid refresh token"})
		return
	}

	var user model.User
	if err := h.db.First(&user, claims.UserID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
		return
	}

	tokens, err := h.jwtMgr.GenerateTokenPair(user.ID, user.Username, user.Role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"tokens": tokens})
}

func (h *AuthHandler) Me(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var user model.User
	if err := h.db.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"user": user})
}
