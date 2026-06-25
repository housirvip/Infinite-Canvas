package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	gonanoid "github.com/matoous/go-nanoid/v2"

	"github.com/infinite-canvas/backend/internal/model"
	"github.com/infinite-canvas/backend/internal/storage"
)

type OpenAIVideoProvider struct {
	pollMs   int
	timeoutS int
}

func NewOpenAIVideoProvider(pollMs, timeoutS int) *OpenAIVideoProvider {
	if pollMs <= 0 {
		pollMs = 2500
	}
	if timeoutS <= 0 {
		timeoutS = 300
	}
	return &OpenAIVideoProvider{pollMs: pollMs, timeoutS: timeoutS}
}

func (p *OpenAIVideoProvider) Name() string { return "openai_video" }

type videoGenParams struct {
	Model          string   `json:"model"`
	Prompt         string   `json:"prompt"`
	Seconds        int      `json:"seconds"`
	Size           string   `json:"size,omitempty"`
	Resolution     string   `json:"resolution,omitempty"`
	RefFileIDs     []string `json:"refFileIds,omitempty"`
}

func (p *OpenAIVideoProvider) Execute(ctx context.Context, task *model.Task, apiKey string, baseURL string,
	fileStore storage.FileStorage, onProgress ProgressFunc) (*ExecuteResult, error) {

	var params videoGenParams
	if err := json.Unmarshal([]byte(task.Params), &params); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}

	if params.Seconds <= 0 {
		params.Seconds = 6
	}

	onProgress(5, "提交视频生成请求...")

	taskID, err := p.submitVideo(ctx, apiKey, baseURL, &params, fileStore)
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
			Size:     len(videoData),
		}},
	}, nil
}

func (p *OpenAIVideoProvider) submitVideo(ctx context.Context, apiKey, baseURL string,
	params *videoGenParams, fileStore storage.FileStorage) (string, error) {

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)

	w.WriteField("model", params.Model)
	w.WriteField("prompt", params.Prompt)
	w.WriteField("seconds", fmt.Sprintf("%d", params.Seconds))
	w.WriteField("preset", "normal")
	if params.Size != "" {
		w.WriteField("size", params.Size)
	}
	if params.Resolution != "" {
		w.WriteField("resolution_name", params.Resolution)
	}

	for _, fileID := range params.RefFileIDs {
		data, _, err := fileStore.Load(ctx, fileID)
		if err != nil {
			continue
		}
		part, _ := w.CreateFormFile("input_reference", "ref.png")
		part.Write(data)
	}

	w.Close()

	url := strings.TrimSuffix(baseURL, "/") + "/videos"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", w.FormDataContentType())

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("submit failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	result := unwrapResponse(body)

	var taskResp struct {
		ID    string `json:"id"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}

	if err := json.Unmarshal(result, &taskResp); err != nil {
		return "", fmt.Errorf("failed to parse response: %s", string(body))
	}

	if taskResp.Error != nil {
		return "", fmt.Errorf("API error: %s", taskResp.Error.Message)
	}

	if taskResp.ID == "" {
		return "", fmt.Errorf("no task ID in response: %s", string(body))
	}

	return taskResp.ID, nil
}

func (p *OpenAIVideoProvider) pollAndDownload(ctx context.Context, apiKey, baseURL, taskID string,
	onProgress ProgressFunc) ([]byte, error) {

	maxAttempts := p.timeoutS * 1000 / p.pollMs
	if maxAttempts <= 0 {
		maxAttempts = 120
	}

	ticker := time.NewTicker(time.Duration(p.pollMs) * time.Millisecond)
	defer ticker.Stop()

	for attempt := 0; attempt < maxAttempts; attempt++ {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}

		progress := 10 + (attempt * 70 / maxAttempts)
		onProgress(progress, fmt.Sprintf("生成中... (%ds)", (attempt+1)*p.pollMs/1000))

		url := fmt.Sprintf("%s/videos/%s", strings.TrimSuffix(baseURL, "/"), taskID)
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		req.Header.Set("Authorization", "Bearer "+apiKey)

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			continue
		}

		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var status struct {
			Status string `json:"status"`
			Error  *struct {
				Message string `json:"message"`
			} `json:"error"`
		}

		if err := json.Unmarshal(unwrapResponse(body), &status); err != nil {
			continue
		}

		switch status.Status {
		case "completed":
			return p.downloadContent(ctx, apiKey, baseURL, taskID)
		case "failed", "cancelled":
			msg := "video generation failed"
			if status.Error != nil {
				msg = status.Error.Message
			}
			return nil, fmt.Errorf(msg)
		}
	}

	return nil, fmt.Errorf("video generation timed out after %d seconds", p.timeoutS)
}

func (p *OpenAIVideoProvider) downloadContent(ctx context.Context, apiKey, baseURL, taskID string) ([]byte, error) {
	url := fmt.Sprintf("%s/videos/%s/content", strings.TrimSuffix(baseURL, "/"), taskID)
	return downloadURL(ctx, url, "Bearer "+apiKey)
}

func unwrapResponse(body []byte) []byte {
	var envelope struct {
		Code int             `json:"code"`
		Data json.RawMessage `json:"data"`
		Msg  string          `json:"msg"`
	}
	if err := json.Unmarshal(body, &envelope); err == nil && envelope.Data != nil {
		return envelope.Data
	}
	return body
}
