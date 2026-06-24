package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	gonanoid "github.com/matoous/go-nanoid/v2"

	"github.com/infinite-canvas/backend/internal/middleware"
	"github.com/infinite-canvas/backend/internal/model"
	"gorm.io/gorm"
)

type AssetHandler struct {
	db *gorm.DB
}

func NewAssetHandler(db *gorm.DB) *AssetHandler {
	return &AssetHandler{db: db}
}

type CreateAssetRequest struct {
	AssetID string `json:"assetId"`
	Kind    string `json:"kind" binding:"required"`
	Title   string `json:"title"`
	Tags    string `json:"tags"`
	Note    string `json:"note"`
	Data    string `json:"data"`
}

type UpdateAssetRequest struct {
	Title *string `json:"title"`
	Tags  *string `json:"tags"`
	Note  *string `json:"note"`
	Data  *string `json:"data"`
}

func (h *AssetHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "50"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}

	query := h.db.Where("user_id = ?", userID)

	if kind := c.Query("kind"); kind != "" {
		query = query.Where("kind = ?", kind)
	}

	var total int64
	query.Model(&model.Asset{}).Count(&total)

	var assets []model.Asset
	query.Order("created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&assets)

	c.JSON(http.StatusOK, gin.H{
		"assets":   assets,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
	})
}

func (h *AssetHandler) Create(c *gin.Context) {
	var req CreateAssetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := middleware.GetUserID(c)

	assetID := req.AssetID
	if assetID == "" {
		assetID, _ = gonanoid.New(21)
	}

	asset := model.Asset{
		AssetID:  assetID,
		UserID:   userID,
		Kind:     req.Kind,
		Title:    req.Title,
		Tags:     req.Tags,
		Note:     req.Note,
		DataJSON: req.Data,
	}

	if err := h.db.Create(&asset).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create asset"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"asset": asset})
}

func (h *AssetHandler) Get(c *gin.Context) {
	userID := middleware.GetUserID(c)
	assetID := c.Param("assetId")

	var asset model.Asset
	if err := h.db.Where("asset_id = ? AND user_id = ?", assetID, userID).First(&asset).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "asset not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"asset": asset})
}

func (h *AssetHandler) Update(c *gin.Context) {
	userID := middleware.GetUserID(c)
	assetID := c.Param("assetId")

	var asset model.Asset
	if err := h.db.Where("asset_id = ? AND user_id = ?", assetID, userID).First(&asset).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "asset not found"})
		return
	}

	var req UpdateAssetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]any{}
	if req.Title != nil {
		updates["title"] = *req.Title
	}
	if req.Tags != nil {
		updates["tags"] = *req.Tags
	}
	if req.Note != nil {
		updates["note"] = *req.Note
	}
	if req.Data != nil {
		updates["data_json"] = *req.Data
	}

	if err := h.db.Model(&asset).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update asset"})
		return
	}

	h.db.Where("asset_id = ? AND user_id = ?", assetID, userID).First(&asset)
	c.JSON(http.StatusOK, gin.H{"asset": asset})
}

func (h *AssetHandler) Delete(c *gin.Context) {
	userID := middleware.GetUserID(c)
	assetID := c.Param("assetId")

	result := h.db.Where("asset_id = ? AND user_id = ?", assetID, userID).Delete(&model.Asset{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "asset not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "asset deleted"})
}
