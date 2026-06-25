package handler

import (
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	gonanoid "github.com/matoous/go-nanoid/v2"

	"github.com/infinite-canvas/backend/internal/provider"
	"github.com/infinite-canvas/backend/internal/storage"
)

type FileHandler struct {
	store         storage.FileStorage
	maxFileSizeMB int
}

func NewFileHandler(store storage.FileStorage, maxFileSizeMB int) *FileHandler {
	if maxFileSizeMB <= 0 {
		maxFileSizeMB = 200
	}
	return &FileHandler{store: store, maxFileSizeMB: maxFileSizeMB}
}

func (h *FileHandler) Upload(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, int64(h.maxFileSizeMB)<<20)

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no file provided"})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read file"})
		return
	}

	mimeType := header.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = http.DetectContentType(data)
	}

	fileID, _ := gonanoid.New(21)

	url, err := h.store.Save(c.Request.Context(), fileID, data, mimeType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
		return
	}

	resp := gin.H{
		"fileId":   fileID,
		"url":      url,
		"mimeType": mimeType,
		"size":     len(data),
		"filename": header.Filename,
	}

	if strings.HasPrefix(mimeType, "image/") {
		w, h := provider.ImageDimensions(data)
		if w > 0 && h > 0 {
			resp["width"] = w
			resp["height"] = h
		}
	}

	c.JSON(http.StatusOK, resp)
}

func (h *FileHandler) Download(c *gin.Context) {
	fileID := c.Param("fileId")
	if len(fileID) < 3 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file id"})
		return
	}

	data, mimeType, err := h.store.Load(c.Request.Context(), fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}

	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Data(http.StatusOK, mimeType, data)
}
