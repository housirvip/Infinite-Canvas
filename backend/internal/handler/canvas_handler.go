package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	gonanoid "github.com/matoous/go-nanoid/v2"

	"github.com/infinite-canvas/backend/internal/middleware"
	"github.com/infinite-canvas/backend/internal/model"
	"gorm.io/gorm"
)

type CanvasProjectHandler struct {
	db *gorm.DB
}

func NewCanvasProjectHandler(db *gorm.DB) *CanvasProjectHandler {
	return &CanvasProjectHandler{db: db}
}

type ProjectListItem struct {
	ID              uint   `json:"id"`
	ProjectID       string `json:"projectId"`
	Title           string `json:"title"`
	BackgroundMode  string `json:"backgroundMode"`
	NodeCount       int    `json:"nodeCount"`
	ConnectionCount int    `json:"connectionCount"`
	CreatedAt       string `json:"createdAt"`
	UpdatedAt       string `json:"updatedAt"`
}

type ProjectFullResponse struct {
	model.CanvasProject
	Nodes        json.RawMessage `json:"nodes"`
	Connections  json.RawMessage `json:"connections"`
	ChatSessions json.RawMessage `json:"chatSessions"`
}

type CreateProjectRequest struct {
	ProjectID      string          `json:"projectId"`
	Title          string          `json:"title"`
	BackgroundMode string          `json:"backgroundMode"`
	ShowImageInfo  bool            `json:"showImageInfo"`
	ViewportX      float64         `json:"viewportX"`
	ViewportY      float64         `json:"viewportY"`
	ViewportK      float64         `json:"viewportK"`
	ActiveChatID   string          `json:"activeChatId"`
	Nodes          json.RawMessage `json:"nodes"`
	Connections    json.RawMessage `json:"connections"`
	ChatSessions   json.RawMessage `json:"chatSessions"`
}

type UpdateProjectRequest struct {
	Title          *string         `json:"title"`
	BackgroundMode *string         `json:"backgroundMode"`
	ShowImageInfo  *bool           `json:"showImageInfo"`
	ViewportX      *float64        `json:"viewportX"`
	ViewportY      *float64        `json:"viewportY"`
	ViewportK      *float64        `json:"viewportK"`
	ActiveChatID   *string         `json:"activeChatId"`
	Nodes          json.RawMessage `json:"nodes"`
	Connections    json.RawMessage `json:"connections"`
	ChatSessions   json.RawMessage `json:"chatSessions"`
}

func (h *CanvasProjectHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "50"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}

	var projects []model.CanvasProject
	var total int64

	query := h.db.Where("user_id = ?", userID)
	query.Model(&model.CanvasProject{}).Count(&total)
	query.Select("id, project_id, user_id, title, background_mode, nodes_json, connections_json, created_at, updated_at").
		Order("updated_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&projects)

	items := make([]ProjectListItem, len(projects))
	for i, p := range projects {
		nodeCount := 0
		if p.NodesJSON != "" {
			var nodes []json.RawMessage
			if json.Unmarshal([]byte(p.NodesJSON), &nodes) == nil {
				nodeCount = len(nodes)
			}
		}
		connectionCount := 0
		if p.ConnectionsJSON != "" {
			var conns []json.RawMessage
			if json.Unmarshal([]byte(p.ConnectionsJSON), &conns) == nil {
				connectionCount = len(conns)
			}
		}
		items[i] = ProjectListItem{
			ID:              p.ID,
			ProjectID:       p.ProjectID,
			Title:           p.Title,
			BackgroundMode:  p.BackgroundMode,
			NodeCount:       nodeCount,
			ConnectionCount: connectionCount,
			CreatedAt:      p.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			UpdatedAt:      p.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"projects": items,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
	})
}

func (h *CanvasProjectHandler) Create(c *gin.Context) {
	var req CreateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := middleware.GetUserID(c)

	projectID := req.ProjectID
	if projectID == "" {
		projectID, _ = gonanoid.New(21)
	}

	bgMode := req.BackgroundMode
	if bgMode == "" {
		bgMode = "lines"
	}

	vk := req.ViewportK
	if vk == 0 {
		vk = 1
	}

	nodesJSON := "[]"
	if len(req.Nodes) > 0 {
		nodesJSON = string(req.Nodes)
	}
	connsJSON := "[]"
	if len(req.Connections) > 0 {
		connsJSON = string(req.Connections)
	}
	chatsJSON := "[]"
	if len(req.ChatSessions) > 0 {
		chatsJSON = string(req.ChatSessions)
	}

	project := model.CanvasProject{
		ProjectID:        projectID,
		UserID:           userID,
		Title:            req.Title,
		BackgroundMode:   bgMode,
		ShowImageInfo:    req.ShowImageInfo,
		ViewportX:        req.ViewportX,
		ViewportY:        req.ViewportY,
		ViewportK:        vk,
		NodesJSON:        nodesJSON,
		ConnectionsJSON:  connsJSON,
		ChatSessionsJSON: chatsJSON,
		ActiveChatID:     req.ActiveChatID,
	}

	if err := h.db.Create(&project).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create project"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"project": toProjectFull(project)})
}

func (h *CanvasProjectHandler) Get(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("projectId")

	var project model.CanvasProject
	if err := h.db.Where("project_id = ? AND user_id = ?", projectID, userID).First(&project).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"project": toProjectFull(project)})
}

func (h *CanvasProjectHandler) Update(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("projectId")

	var project model.CanvasProject
	if err := h.db.Where("project_id = ? AND user_id = ?", projectID, userID).First(&project).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	var req UpdateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]any{}
	if req.Title != nil {
		updates["title"] = *req.Title
	}
	if req.BackgroundMode != nil {
		updates["background_mode"] = *req.BackgroundMode
	}
	if req.ShowImageInfo != nil {
		updates["show_image_info"] = *req.ShowImageInfo
	}
	if req.ViewportX != nil {
		updates["viewport_x"] = *req.ViewportX
	}
	if req.ViewportY != nil {
		updates["viewport_y"] = *req.ViewportY
	}
	if req.ViewportK != nil {
		updates["viewport_k"] = *req.ViewportK
	}
	if req.ActiveChatID != nil {
		updates["active_chat_id"] = *req.ActiveChatID
	}
	if len(req.Nodes) > 0 {
		updates["nodes_json"] = string(req.Nodes)
	}
	if len(req.Connections) > 0 {
		updates["connections_json"] = string(req.Connections)
	}
	if len(req.ChatSessions) > 0 {
		updates["chat_sessions_json"] = string(req.ChatSessions)
	}

	if err := h.db.Model(&project).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update project"})
		return
	}

	h.db.Where("project_id = ? AND user_id = ?", projectID, userID).First(&project)
	c.JSON(http.StatusOK, gin.H{"project": toProjectFull(project)})
}

func (h *CanvasProjectHandler) Delete(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("projectId")

	result := h.db.Where("project_id = ? AND user_id = ?", projectID, userID).Delete(&model.CanvasProject{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "project deleted"})
}

func toProjectFull(p model.CanvasProject) ProjectFullResponse {
	nodes := json.RawMessage("[]")
	if p.NodesJSON != "" {
		nodes = json.RawMessage(p.NodesJSON)
	}
	conns := json.RawMessage("[]")
	if p.ConnectionsJSON != "" {
		conns = json.RawMessage(p.ConnectionsJSON)
	}
	chats := json.RawMessage("[]")
	if p.ChatSessionsJSON != "" {
		chats = json.RawMessage(p.ChatSessionsJSON)
	}
	return ProjectFullResponse{
		CanvasProject: p,
		Nodes:         nodes,
		Connections:   conns,
		ChatSessions:  chats,
	}
}
