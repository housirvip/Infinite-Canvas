package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	gonanoid "github.com/matoous/go-nanoid/v2"

	"github.com/infinite-canvas/backend/internal/model"
	"github.com/infinite-canvas/backend/internal/storage"
)

type SeedanceVideoProvider struct{}

func NewSeedanceVideoProvider() *SeedanceVideoProvider {
	return &SeedanceVideoProvider{}
}

func (p *SeedanceVideoProvider) Name() string { return "seedance" }

type seedanceParams struct {
	Model         string   `json:"model"`
	Prompt        string   `json:"prompt"`
	Ratio         string   `json:"ratio,omitempty"`
	Resolution    string   `json:"resolution,omitempty"`
	Duration      int      `json:"duration,omitempty"`
	GenerateAudio bool     `json:"generateAudio"`
	Watermark     bool     `json:"watermark"`
	RefImageIDs   []string `json:"refImageIds,omitempty"`
	RefVideoIDs   []string `json:"refVideoIds,omitempty"`
	RefAudioIDs   []string `json:"refAudioIds,omitempty"`
}

func (p *SeedanceVideoProvider) Execute(ctx context.Context, task *model.Task, apiKey string, baseURL string,
	fileStore storage.FileStorage, onProgress ProgressFunc) (*ExecuteResult, error) {

	var params seedanceParams
	if err := json.Unmarshal([]byte(task.Params), &params); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}

	onProgress(5, "提交 Seedance 视频请求...")

	taskID, err := p.submit(ctx, apiKey, baseURL, &params, fileStore)
	if err != nil {
		return nil, err
	}

	onProgress(10, "等待生成中...")

	videoData, err := p.pollAndDownload(ctx, apiKey, baseURL, taskID, onProgress)
	if err != nil {
		return nil, err
	}

	onProgress(90, "保存结果...")

	fileID, _ := gonanoid.New(21)
	url, err := fileStore.Save(ctx, fileID, videoData, "video/mp4")
	if err != nil {
		return nil, fmt.Errorf("failed to save video: %w", err)
	}

	onProgress(100, "完成")
	return &ExecuteResult{
		UpstreamID: taskID,
		Files: []ResultFile{{
			FileID:   fileID,
			URL:      url,
			MimeType: "video/mp4",
		}},
	}, nil
}

func (p *SeedanceVideoProvider) submit(ctx context.Context, apiKey, baseURL string,
	params *seedanceParams, fileStore storage.FileStorage) (string, error) {

	content := []map[string]any{
		{"type": "text", "text": params.Prompt},
	}

	for _, fileID := range params.RefImageIDs {
		url := fileStore.URL(fileID)
		content = append(content, map[string]any{
			"type":      "image_url",
			"image_url": map[string]string{"url": url},
			"role":      "reference_image",
		})
	}

	for _, fileID := range params.RefVideoIDs {
		url := fileStore.URL(fileID)
		content = append(content, map[string]any{
			"type":      "video_url",
			"video_url": map[string]string{"url": url},
			"role":      "reference_video",
		})
	}

	for _, fileID := range params.RefAudioIDs {
		url := fileStore.URL(fileID)
		content = append(content, map[string]any{
			"type":      "audio_url",
			"audio_url": map[string]string{"url": url},
			"role":      "reference_audio",
		})
	}

	body := map[string]any{
		"model":          params.Model,
		"content":        content,
		"generate_audio": params.GenerateAudio,
		"watermark":      params.Watermark,
	}
	if params.Ratio != "" {
		body["ratio"] = params.Ratio
	}
	if params.Resolution != "" {
		body["resolution"] = params.Resolution
	}
	if params.Duration > 0 {
		body["duration"] = params.Duration
	}

	jsonData, _ := json.Marshal(body)
	url := strings.TrimSuffix(baseURL, "/") + "/contents/generations/tasks"

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(jsonData))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("submit failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	data := unwrapResponse(respBody)

	var taskResp struct {
		ID     string `json:"id"`
		Status string `json:"status"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}

	if err := json.Unmarshal(data, &taskResp); err != nil {
		return "", fmt.Errorf("failed to parse response: %s", string(respBody))
	}

	if taskResp.Error != nil {
		return "", fmt.Errorf("API error: %s", taskResp.Error.Message)
	}

	if taskResp.ID == "" {
		return "", fmt.Errorf("no task ID in response: %s", string(respBody))
	}

	return taskResp.ID, nil
}

func (p *SeedanceVideoProvider) pollAndDownload(ctx context.Context, apiKey, baseURL, taskID string,
	onProgress ProgressFunc) ([]byte, error) {

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for attempt := 0; attempt < 120; attempt++ {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}

		progress := 10 + (attempt * 70 / 120)
		onProgress(progress, fmt.Sprintf("生成中... (%ds)", (attempt+1)*5))

		url := fmt.Sprintf("%s/contents/generations/tasks/%s", strings.TrimSuffix(baseURL, "/"), taskID)
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		req.Header.Set("Authorization", "Bearer "+apiKey)

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			continue
		}

		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var status struct {
			Status  string `json:"status"`
			Content *struct {
				VideoURL string `json:"video_url"`
			} `json:"content"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}

		if err := json.Unmarshal(unwrapResponse(body), &status); err != nil {
			continue
		}

		switch status.Status {
		case "succeeded":
			if status.Content == nil || status.Content.VideoURL == "" {
				return nil, fmt.Errorf("no video URL in completed response")
			}
			return downloadURL(ctx, status.Content.VideoURL, "")
		case "failed", "cancelled", "expired":
			msg := "video generation failed"
			if status.Error != nil {
				msg = status.Error.Message
			}
			return nil, fmt.Errorf(msg)
		}
	}

	return nil, fmt.Errorf("video generation timed out after 10 minutes")
}
