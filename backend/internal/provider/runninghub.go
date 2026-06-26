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

const defaultRunningHubBaseURL = "https://www.runninghub.cn"

type RunningHubProvider struct {
	pollMs   int
	timeoutS int
}

func NewRunningHubProvider(pollMs, timeoutS int) *RunningHubProvider {
	if pollMs <= 0 {
		pollMs = 4000
	}
	if timeoutS <= 0 {
		timeoutS = 600
	}
	return &RunningHubProvider{pollMs: pollMs, timeoutS: timeoutS}
}

func (p *RunningHubProvider) Name() string { return "runninghub" }

type runninghubParams struct {
	WorkflowID   string `json:"workflowId"`
	InstanceType string `json:"instanceType"`
	Timeout      int    `json:"timeout"`
	NodeInfoList []struct {
		NodeID      string `json:"nodeId"`
		FieldName   string `json:"fieldName"`
		FieldValue  string `json:"fieldValue"`
		Description string `json:"description,omitempty"`
	} `json:"nodeInfoList"`
	MediaFileIDs map[string]string `json:"mediaFileIds,omitempty"`
}

func (p *RunningHubProvider) Execute(ctx context.Context, task *model.Task, apiKey string, baseURL string,
	fileStore storage.FileStorage, onProgress ProgressFunc) (*ExecuteResult, error) {

	if baseURL == "" {
		baseURL = defaultRunningHubBaseURL
	}

	var params runninghubParams
	if err := json.Unmarshal([]byte(task.Params), &params); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}

	if params.MediaFileIDs == nil {
		params.MediaFileIDs = make(map[string]string)
	}

	if params.InstanceType == "" {
		params.InstanceType = "default"
	}
	timeout := params.Timeout
	if timeout <= 0 {
		timeout = p.timeoutS
	}

	onProgress(5, "上传媒体文件...")

	for key, fileID := range params.MediaFileIDs {
		data, _, err := fileStore.Load(ctx, fileID)
		if err != nil {
			return nil, fmt.Errorf("failed to load media file %s: %w", fileID, err)
		}

		uploadURL, err := p.uploadMedia(ctx, apiKey, baseURL, data)
		if err != nil {
			return nil, fmt.Errorf("failed to upload media: %w", err)
		}

		for i := range params.NodeInfoList {
			nodeKey := params.NodeInfoList[i].NodeID + ":" + params.NodeInfoList[i].FieldName
			if nodeKey == key {
				params.NodeInfoList[i].FieldValue = uploadURL
			}
		}
	}

	onProgress(15, "提交工作流任务...")

	taskID, err := p.submitTask(ctx, apiKey, baseURL, params.WorkflowID, params.NodeInfoList, params.InstanceType)
	if err != nil {
		return nil, err
	}

	task.UpstreamTaskID = taskID

	onProgress(20, "等待执行...")

	results, err := p.pollTask(ctx, apiKey, baseURL, taskID, timeout, onProgress)
	if err != nil {
		return nil, err
	}

	onProgress(85, "下载结果...")

	execResult := &ExecuteResult{UpstreamID: taskID}

	for _, r := range results {
		if isImageOutput(r.OutputType) || isVideoOutput(r.OutputType) || isAudioOutput(r.OutputType) {
			data, err := downloadURL(ctx, r.URL, "")
			if err != nil {
				continue
			}

			mimeType := mimeFromOutputType(r.OutputType)
			fID, _ := gonanoid.New(21)
			url, err := fileStore.Save(ctx, fID, data, mimeType)
			if err != nil {
				continue
			}

			rf := ResultFile{
				FileID:   fID,
				URL:      url,
				MimeType: mimeType,
				Size:     len(data),
			}
			if isImageOutput(r.OutputType) {
				rf.Width, rf.Height = ImageDimensions(data)
			}
			execResult.Files = append(execResult.Files, rf)
		} else if r.Text != "" {
			execResult.Text += r.Text + "\n"
		}
	}

	onProgress(100, "完成")
	return execResult, nil
}

func (p *RunningHubProvider) uploadMedia(ctx context.Context, apiKey string, baseURL string, data []byte) (string, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", "upload.bin")
	if err != nil {
		return "", err
	}
	part.Write(data)
	w.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		baseURL+"/openapi/v2/media/upload/binary", &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", w.FormDataContentType())

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var result struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    *struct {
			DownloadURL string `json:"download_url"`
		} `json:"data"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("failed to parse upload response: %s", string(body))
	}

	if result.Data == nil || result.Data.DownloadURL == "" {
		return "", fmt.Errorf("upload failed: %s", result.Message)
	}

	return result.Data.DownloadURL, nil
}

func (p *RunningHubProvider) submitTask(ctx context.Context, apiKey, baseURL, workflowID string, nodeInfoList any, instanceType string) (string, error) {
	body := map[string]any{
		"nodeInfoList": nodeInfoList,
		"instanceType": instanceType,
	}

	jsonData, _ := json.Marshal(body)
	url := fmt.Sprintf("%s/openapi/v2/run/ai-app/%s", baseURL, workflowID)

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

	var taskResp struct {
		TaskID       string `json:"taskId"`
		Status       string `json:"status"`
		ErrorMessage string `json:"errorMessage"`
	}

	if err := json.Unmarshal(respBody, &taskResp); err != nil {
		return "", fmt.Errorf("failed to parse response: %s", string(respBody))
	}

	if taskResp.TaskID == "" {
		return "", fmt.Errorf("submit failed: %s", taskResp.ErrorMessage)
	}

	return taskResp.TaskID, nil
}

type rhResult struct {
	URL        string `json:"url"`
	NodeID     string `json:"nodeId"`
	OutputType string `json:"outputType"`
	Text       string `json:"text"`
}

func (p *RunningHubProvider) pollTask(ctx context.Context, apiKey, baseURL, taskID string, timeoutS int,
	onProgress ProgressFunc) ([]rhResult, error) {

	maxAttempts := (timeoutS * 1000) / p.pollMs
	if maxAttempts <= 0 {
		maxAttempts = 150
	}

	ticker := time.NewTicker(time.Duration(p.pollMs) * time.Millisecond)
	defer ticker.Stop()

	for attempt := 0; attempt < maxAttempts; attempt++ {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}

		progress := 20 + (attempt * 60 / maxAttempts)
		if progress > 80 {
			progress = 80
		}
		onProgress(progress, fmt.Sprintf("执行中... (%ds)", (attempt+1)*p.pollMs/1000))

		body, _ := json.Marshal(map[string]string{"taskId": taskID})
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
			baseURL+"/openapi/v2/query", bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+apiKey)
		req.Header.Set("Content-Type", "application/json")

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			continue
		}

		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var taskResp struct {
			TaskID       string     `json:"taskId"`
			Status       string     `json:"status"`
			ErrorMessage string     `json:"errorMessage"`
			Results      []rhResult `json:"results"`
		}

		if err := json.Unmarshal(respBody, &taskResp); err != nil {
			continue
		}

		switch taskResp.Status {
		case "SUCCESS":
			return taskResp.Results, nil
		case "FAILED":
			return nil, fmt.Errorf("task failed: %s", taskResp.ErrorMessage)
		}
	}

	return nil, fmt.Errorf("task timed out after %d seconds", timeoutS)
}

func isImageOutput(t string) bool {
	t = strings.ToLower(t)
	return t == "png" || t == "jpg" || t == "jpeg" || t == "webp" || t == "gif" || t == "bmp"
}

func isVideoOutput(t string) bool {
	t = strings.ToLower(t)
	return t == "mp4" || t == "mov" || t == "avi" || t == "webm"
}

func isAudioOutput(t string) bool {
	t = strings.ToLower(t)
	return t == "mp3" || t == "wav" || t == "ogg" || t == "flac" || t == "m4a" || t == "aac"
}

func (p *RunningHubProvider) CancelUpstreamTask(apiKey, baseURL, upstreamTaskID string) error {
	if baseURL == "" {
		baseURL = defaultRunningHubBaseURL
	}
	body, _ := json.Marshal(map[string]string{
		"apiKey": apiKey,
		"taskId": upstreamTaskID,
	})
	req, err := http.NewRequest(http.MethodPost,
		baseURL+"/task/openapi/cancel", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

func mimeFromOutputType(t string) string {
	switch strings.ToLower(t) {
	case "png":
		return "image/png"
	case "jpg", "jpeg":
		return "image/jpeg"
	case "webp":
		return "image/webp"
	case "gif":
		return "image/gif"
	case "mp4":
		return "video/mp4"
	case "mov":
		return "video/quicktime"
	case "webm":
		return "video/webm"
	case "mp3":
		return "audio/mpeg"
	case "wav":
		return "audio/wav"
	case "ogg":
		return "audio/ogg"
	case "flac":
		return "audio/flac"
	case "m4a":
		return "audio/mp4"
	case "aac":
		return "audio/aac"
	default:
		return "application/octet-stream"
	}
}
