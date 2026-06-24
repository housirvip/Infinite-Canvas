package storage

import "context"

type FileStorage interface {
	Save(ctx context.Context, fileID string, data []byte, mimeType string) (url string, err error)
	Load(ctx context.Context, fileID string) (data []byte, mimeType string, err error)
	Delete(ctx context.Context, fileID string) error
	URL(fileID string) string
}
