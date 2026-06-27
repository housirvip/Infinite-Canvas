package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	gonanoid "github.com/matoous/go-nanoid/v2"

	"github.com/infinite-canvas/backend/internal/model"
	"github.com/infinite-canvas/backend/internal/storage"
)

type AudioProvider struct{}

func NewAudioProvider() *AudioProvider {
	return &AudioProvider{}
}

func (p *AudioProvider) Name() string { return "audio" }

type audioParams struct {
	Model          string  `json:"model"`
	Voice          string  `json:"voice"`
	ResponseFormat string  `json:"responseFormat"`
	Speed          float64 `json:"speed"`
	Instructions   string  `json:"instructions,omitempty"`
}

func (p *AudioProvider) Execute(ctx context.Context, task *model.Task, apiKey string, baseURL string,
	fileStore storage.FileStorage, onProgress ProgressFunc) (*ExecuteResult, error) {

	var params audioParams
	if err := json.Unmarshal([]byte(task.Params), &params); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}

	if params.Speed <= 0 {
		params.Speed = 1.0
	}
	if params.ResponseFormat == "" {
		params.ResponseFormat = "mp3"
	}

	onProgress(10, "提交音频生成请求...")

	body := map[string]any{
		"model":           params.Model,
		"input":           task.Prompt,
		"voice":           params.Voice,
		"response_format": params.ResponseFormat,
		"speed":           params.Speed,
	}
	if params.Instructions != "" {
		body["instructions"] = params.Instructions
	}

	jsonData, _ := json.Marshal(body)
	url := strings.TrimSuffix(baseURL, "/") + "/audio/speech"

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(jsonData))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	ApplyTraceHeader(ctx, req)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	audioData, _ := io.ReadAll(resp.Body)

	contentType := resp.Header.Get("Content-Type")
	if strings.Contains(contentType, "json") {
		var errResp struct {
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal(audioData, &errResp) == nil && errResp.Error != nil {
			return nil, fmt.Errorf("API error: %s", errResp.Error.Message)
		}
		return nil, fmt.Errorf("unexpected JSON response: %s", string(audioData))
	}

	onProgress(80, "保存结果...")

	mimeType := "audio/" + params.ResponseFormat
	fileID, _ := gonanoid.New(21)
	fileURL, err := fileStore.Save(ctx, fileID, audioData, mimeType)
	if err != nil {
		return nil, fmt.Errorf("failed to save audio: %w", err)
	}

	onProgress(100, "完成")
	return &ExecuteResult{
		Files: []ResultFile{{
			FileID:   fileID,
			URL:      fileURL,
			MimeType: mimeType,
			Size:     len(audioData),
		}},
	}, nil
}
