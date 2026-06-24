package provider

import (
	"context"

	"github.com/infinite-canvas/backend/internal/model"
	"github.com/infinite-canvas/backend/internal/storage"
)

type ResultFile struct {
	Data     []byte `json:"-"`
	FileID   string `json:"fileId"`
	URL      string `json:"url"`
	MimeType string `json:"mimeType"`
}

type ExecuteResult struct {
	Files      []ResultFile `json:"files,omitempty"`
	Text       string       `json:"text,omitempty"`
	UpstreamID string       `json:"upstreamId,omitempty"`
}

type ProgressFunc func(progress int, text string)

type Provider interface {
	Name() string
	Execute(ctx context.Context, task *model.Task, apiKey string, baseURL string,
		fileStore storage.FileStorage, onProgress ProgressFunc) (*ExecuteResult, error)
}
