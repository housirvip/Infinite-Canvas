package provider

import (
	"bytes"
	"context"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	_ "golang.org/x/image/webp"

	"github.com/infinite-canvas/backend/internal/model"
	"github.com/infinite-canvas/backend/internal/storage"
)

type ResultFile struct {
	Data     []byte `json:"-"`
	FileID   string `json:"fileId"`
	URL      string `json:"url"`
	MimeType string `json:"mimeType"`
	Size     int    `json:"size"`
	Width    int    `json:"width,omitempty"`
	Height   int    `json:"height,omitempty"`
}

func ImageDimensions(data []byte) (width, height int) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return 0, 0
	}
	return cfg.Width, cfg.Height
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
