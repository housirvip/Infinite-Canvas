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
	dir, err := localFileDir(s.baseDir, fileID)
	if err != nil {
		return "", err
	}

	ext := extFromMime(mimeType)
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
	dir, err := localFileDir(s.baseDir, fileID)
	if err != nil {
		return nil, "", err
	}

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
	dir, err := localFileDir(s.baseDir, fileID)
	if err != nil {
		return err
	}

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
	if err := validateLocalFileID(fileID); err != nil {
		return ""
	}
	return s.baseURL + "/" + fileID
}

func localFileDir(baseDir, fileID string) (string, error) {
	if err := validateLocalFileID(fileID); err != nil {
		return "", err
	}
	return filepath.Join(baseDir, fileID[:2]), nil
}

func validateLocalFileID(fileID string) error {
	if len(fileID) < 3 {
		return fmt.Errorf("invalid file id")
	}
	for i := 0; i < len(fileID); i++ {
		ch := fileID[i]
		if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' {
			continue
		}
		return fmt.Errorf("invalid file id")
	}
	return nil
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
