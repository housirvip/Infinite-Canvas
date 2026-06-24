package storage

import (
	"context"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"strings"
)

type LocalStorage struct {
	baseDir string
	baseURL string
}

func NewLocalStorage(baseDir, baseURL string) (*LocalStorage, error) {
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create storage dir: %w", err)
	}
	if baseURL == "" {
		baseURL = "/api/v1/files"
	}
	return &LocalStorage{baseDir: baseDir, baseURL: baseURL}, nil
}

func (s *LocalStorage) Save(_ context.Context, fileID string, data []byte, mimeType string) (string, error) {
	ext := extFromMime(mimeType)
	dir := filepath.Join(s.baseDir, fileID[:2])
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}

	filename := fileID + ext
	path := filepath.Join(dir, filename)
	if err := os.WriteFile(path, data, 0644); err != nil {
		return "", err
	}

	return s.URL(fileID), nil
}

func (s *LocalStorage) Load(_ context.Context, fileID string) ([]byte, string, error) {
	dir := filepath.Join(s.baseDir, fileID[:2])
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, "", fmt.Errorf("file not found: %s", fileID)
	}

	for _, e := range entries {
		if strings.HasPrefix(e.Name(), fileID) {
			path := filepath.Join(dir, e.Name())
			data, err := os.ReadFile(path)
			if err != nil {
				return nil, "", err
			}
			ext := filepath.Ext(e.Name())
			mimeType := mime.TypeByExtension(ext)
			if mimeType == "" {
				mimeType = "application/octet-stream"
			}
			return data, mimeType, nil
		}
	}

	return nil, "", fmt.Errorf("file not found: %s", fileID)
}

func (s *LocalStorage) Delete(_ context.Context, fileID string) error {
	dir := filepath.Join(s.baseDir, fileID[:2])
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), fileID) {
			return os.Remove(filepath.Join(dir, e.Name()))
		}
	}
	return nil
}

func (s *LocalStorage) URL(fileID string) string {
	return s.baseURL + "/" + fileID
}

func extFromMime(mimeType string) string {
	switch {
	case strings.Contains(mimeType, "png"):
		return ".png"
	case strings.Contains(mimeType, "jpeg"), strings.Contains(mimeType, "jpg"):
		return ".jpg"
	case strings.Contains(mimeType, "webp"):
		return ".webp"
	case strings.Contains(mimeType, "gif"):
		return ".gif"
	case strings.Contains(mimeType, "mp4"):
		return ".mp4"
	case strings.Contains(mimeType, "webm"):
		return ".webm"
	case strings.Contains(mimeType, "mp3"):
		return ".mp3"
	case strings.Contains(mimeType, "wav"):
		return ".wav"
	case strings.Contains(mimeType, "ogg"):
		return ".ogg"
	default:
		exts, _ := mime.ExtensionsByType(mimeType)
		if len(exts) > 0 {
			return exts[0]
		}
		return ".bin"
	}
}
