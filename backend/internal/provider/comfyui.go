package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	gonanoid "github.com/matoous/go-nanoid/v2"

	"github.com/infinite-canvas/backend/internal/model"
	"github.com/infinite-canvas/backend/internal/storage"
)

var providerHTTPClient = &http.Client{Timeout: 120 * time.Second}

type ComfyUIProvider struct {
	pollMs   int
	timeoutS int
}

func NewComfyUIProvider(pollMs, timeoutS int) *ComfyUIProvider {
	if pollMs <= 0 {
		pollMs = 2000
	}
	if timeoutS <= 0 {
		timeoutS = 600
	}
	return &ComfyUIProvider{pollMs: pollMs, timeoutS: timeoutS}
}

func (p *ComfyUIProvider) Name() string { return "comfyui" }

type comfyuiParams struct {
	WorkflowJSON string            `json:"workflowJson"`
	Timeout      int               `json:"timeout"`
	MediaFileIDs map[string]string `json:"mediaFileIds,omitempty"`
}

func (p *ComfyUIProvider) Execute(ctx context.Context, task *model.Task, apiKey string, baseURL string,
	fileStore storage.FileStorage, onProgress ProgressFunc) (*ExecuteResult, error) {

	if baseURL == "" {
		return nil, fmt.Errorf("ComfyUI server URL not configured")
	}
	baseURL = strings.TrimSuffix(baseURL, "/")

	var params comfyuiParams
	if err := json.Unmarshal([]byte(task.Params), &params); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}

	if strings.TrimSpace(params.WorkflowJSON) == "" {
		return nil, fmt.Errorf("workflow JSON is empty")
	}

	var workflow map[string]any
	if err := json.Unmarshal([]byte(params.WorkflowJSON), &workflow); err != nil {
		return nil, fmt.Errorf("invalid workflow JSON: %w", err)
	}

	if len(params.MediaFileIDs) > 0 {
		onProgress(5, "上传媒体文件...")
		for key, fileID := range params.MediaFileIDs {
			data, _, err := fileStore.Load(ctx, fileID)
			if err != nil {
				return nil, fmt.Errorf("failed to load media file %s: %w", fileID, err)
			}

			uploadedName, err := p.uploadImage(ctx, apiKey, baseURL, data, fileID)
			if err != nil {
				return nil, fmt.Errorf("failed to upload media to ComfyUI: %w", err)
			}

			parts := strings.SplitN(key, ":", 2)
			if len(parts) == 2 {
				nodeID, fieldName := parts[0], parts[1]
				if node, ok := workflow[nodeID].(map[string]any); ok {
					if inputs, ok := node["inputs"].(map[string]any); ok {
						inputs[fieldName] = uploadedName
					}
				}
			}
		}
	}

	if hasWidgetKeys(workflow) {
		if err := p.resolveWidgetKeys(ctx, apiKey, baseURL, workflow); err != nil {
			return nil, fmt.Errorf("failed to resolve widget keys: %w", err)
		}
	}

	timeout := params.Timeout
	if timeout <= 0 {
		timeout = p.timeoutS
	}

	onProgress(10, "提交工作流...")

	clientID, _ := gonanoid.New(21)
	promptID, err := p.submitPrompt(ctx, apiKey, baseURL, workflow, clientID)
	if err != nil {
		return nil, err
	}

	task.UpstreamTaskID = promptID

	onProgress(20, "等待执行...")

	outputs, err := p.pollHistory(ctx, baseURL, apiKey, promptID, timeout, onProgress)
	if err != nil {
		return nil, err
	}

	onProgress(85, "下载结果...")

	execResult := &ExecuteResult{UpstreamID: promptID}

	for _, output := range outputs {
		for _, img := range output.Images {
			data, mimeType, err := p.downloadOutput(ctx, baseURL, apiKey, img.Filename, img.Subfolder, img.Type)
			if err != nil {
				continue
			}

			fID, _ := gonanoid.New(21)
			fileURL, err := fileStore.Save(ctx, fID, data, mimeType)
			if err != nil {
				continue
			}

			rf := ResultFile{
				FileID:   fID,
				URL:      fileURL,
				MimeType: mimeType,
				Size:     len(data),
			}
			if strings.HasPrefix(mimeType, "image/") {
				rf.Width, rf.Height = ImageDimensions(data)
			}
			execResult.Files = append(execResult.Files, rf)
		}

		for _, vid := range output.Gifs {
			data, mimeType, err := p.downloadOutput(ctx, baseURL, apiKey, vid.Filename, vid.Subfolder, vid.Type)
			if err != nil {
				continue
			}

			fID, _ := gonanoid.New(21)
			fileURL, err := fileStore.Save(ctx, fID, data, mimeType)
			if err != nil {
				continue
			}

			execResult.Files = append(execResult.Files, ResultFile{
				FileID:   fID,
				URL:      fileURL,
				MimeType: mimeType,
				Size:     len(data),
			})
		}
	}

	onProgress(100, "完成")
	return execResult, nil
}

func (p *ComfyUIProvider) uploadImage(ctx context.Context, apiKey, baseURL string, data []byte, filename string) (string, error) {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	ext := filepath.Ext(filename)
	if ext == "" {
		ext = ".png"
	}
	uploadName := "upload" + ext

	part, err := writer.CreateFormFile("image", uploadName)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(data); err != nil {
		return "", err
	}
	writer.WriteField("overwrite", "true")
	writer.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/upload/image", &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := providerHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to upload to ComfyUI: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("ComfyUI upload failed (status %d): %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Name      string `json:"name"`
		Subfolder string `json:"subfolder"`
		Type      string `json:"type"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("failed to parse upload response: %s", string(respBody))
	}

	return result.Name, nil
}

func (p *ComfyUIProvider) submitPrompt(ctx context.Context, apiKey, baseURL string, workflow map[string]any, clientID string) (string, error) {
	body := map[string]any{
		"prompt":    workflow,
		"client_id": clientID,
	}

	jsonData, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/prompt", bytes.NewReader(jsonData))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := providerHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to connect to ComfyUI server: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		var errResp struct {
			Error  string `json:"error"`
			NodeErrors map[string]any `json:"node_errors"`
		}
		if json.Unmarshal(respBody, &errResp) == nil && errResp.Error != "" {
			return "", fmt.Errorf("ComfyUI error: %s", errResp.Error)
		}
		return "", fmt.Errorf("ComfyUI returned status %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		PromptID string `json:"prompt_id"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("failed to parse response: %s", string(respBody))
	}

	if result.PromptID == "" {
		return "", fmt.Errorf("no prompt_id in response: %s", string(respBody))
	}

	return result.PromptID, nil
}

type comfyuiOutputFile struct {
	Filename  string `json:"filename"`
	Subfolder string `json:"subfolder"`
	Type      string `json:"type"`
}

type comfyuiNodeOutput struct {
	Images []comfyuiOutputFile `json:"images"`
	Gifs   []comfyuiOutputFile `json:"gifs"`
}

func (p *ComfyUIProvider) pollHistory(ctx context.Context, baseURL, apiKey, promptID string, timeoutS int,
	onProgress ProgressFunc) (map[string]comfyuiNodeOutput, error) {

	maxAttempts := (timeoutS * 1000) / p.pollMs
	if maxAttempts <= 0 {
		maxAttempts = 300
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

		historyURL := fmt.Sprintf("%s/history/%s", baseURL, promptID)
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, historyURL, nil)
		if apiKey != "" {
			req.Header.Set("Authorization", "Bearer "+apiKey)
		}

		resp, err := providerHTTPClient.Do(req)
		if err != nil {
			continue
		}

		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var history map[string]struct {
			Status struct {
				StatusStr string `json:"status_str"`
				Completed bool   `json:"completed"`
			} `json:"status"`
			Outputs map[string]comfyuiNodeOutput `json:"outputs"`
		}

		if err := json.Unmarshal(body, &history); err != nil {
			continue
		}

		entry, ok := history[promptID]
		if !ok {
			continue
		}

		if entry.Status.StatusStr == "error" {
			return nil, fmt.Errorf("ComfyUI workflow execution failed")
		}

		if entry.Status.Completed {
			return entry.Outputs, nil
		}
	}

	return nil, fmt.Errorf("ComfyUI task timed out after %d seconds", timeoutS)
}

func (p *ComfyUIProvider) downloadOutput(ctx context.Context, baseURL, apiKey, filename, subfolder, outputType string) ([]byte, string, error) {
	params := url.Values{}
	params.Set("filename", filename)
	if subfolder != "" {
		params.Set("subfolder", subfolder)
	}
	if outputType != "" {
		params.Set("type", outputType)
	}

	viewURL := fmt.Sprintf("%s/view?%s", baseURL, params.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, viewURL, nil)
	if err != nil {
		return nil, "", err
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := providerHTTPClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("download failed (status %d)", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return nil, "", err
	}

	mimeType := resp.Header.Get("Content-Type")
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = mimeForExt(filename)
	}

	return data, mimeType, nil
}

func hasWidgetKeys(workflow map[string]any) bool {
	for _, nodeRaw := range workflow {
		node, ok := nodeRaw.(map[string]any)
		if !ok {
			continue
		}
		inputs, ok := node["inputs"].(map[string]any)
		if !ok {
			continue
		}
		for key := range inputs {
			if strings.HasPrefix(key, "widget_") {
				return true
			}
		}
	}
	return false
}

func (p *ComfyUIProvider) resolveWidgetKeys(ctx context.Context, apiKey, baseURL string, workflow map[string]any) error {
	objectInfo, err := p.fetchObjectInfo(ctx, apiKey, baseURL)
	if err != nil {
		return err
	}

	for _, nodeRaw := range workflow {
		node, ok := nodeRaw.(map[string]any)
		if !ok {
			continue
		}
		classType, _ := node["class_type"].(string)
		if classType == "" {
			continue
		}
		inputs, ok := node["inputs"].(map[string]any)
		if !ok {
			continue
		}

		info := objectInfo[classType]
		if info == nil {
			continue
		}

		inputOrder := info.inputOrder()

		resolved := make(map[string]any, len(inputs))
		for key, value := range inputs {
			if !strings.HasPrefix(key, "widget_") {
				resolved[key] = value
				continue
			}
			idxStr := strings.TrimPrefix(key, "widget_")
			idx, err := strconv.Atoi(idxStr)
			if err != nil {
				resolved[key] = value
				continue
			}
			if idx >= 0 && idx < len(inputOrder) {
				resolved[inputOrder[idx]] = value
			} else {
				resolved[key] = value
			}
		}
		node["inputs"] = resolved
	}
	return nil
}

type objectInfoEntry struct {
	Input struct {
		Required json.RawMessage `json:"required"`
		Optional json.RawMessage `json:"optional"`
	} `json:"input"`
}

func (e *objectInfoEntry) inputOrder() []string {
	var names []string
	names = append(names, orderedKeysFiltered(e.Input.Required)...)
	names = append(names, orderedKeysFiltered(e.Input.Optional)...)
	return names
}

func orderedKeysFiltered(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	t, err := dec.Token()
	if err != nil || t != json.Delim('{') {
		return nil
	}
	var keys []string
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		key, ok := tok.(string)
		if !ok {
			break
		}
		var specArr []any
		if err := dec.Decode(&specArr); err != nil {
			break
		}
		if len(specArr) == 0 {
			continue
		}
		firstStr, ok := specArr[0].(string)
		if ok && isComfyUIDataType(firstStr) {
			continue
		}
		keys = append(keys, key)
	}
	return keys
}

func isComfyUIDataType(t string) bool {
	switch t {
	case "STRING", "INT", "FLOAT", "BOOLEAN", "COMBO":
		return false
	case "MODEL", "CLIP", "VAE", "CONDITIONING", "LATENT", "IMAGE",
		"MASK", "CONTROL_NET", "STYLE_MODEL", "GLIGEN",
		"UPSCALE_MODEL", "SIGMAS", "NOISE", "GUIDER", "SAMPLER":
		return true
	default:
		return isAllCapsIdentifier(t)
	}
}

func isAllCapsIdentifier(s string) bool {
	if len(s) == 0 || s[0] < 'A' || s[0] > 'Z' {
		return false
	}
	for _, c := range s {
		if !((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_') {
			return false
		}
	}
	return true
}

func (p *ComfyUIProvider) fetchObjectInfo(ctx context.Context, apiKey, baseURL string) (map[string]*objectInfoEntry, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/object_info", nil)
	if err != nil {
		return nil, err
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := providerHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch object_info: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	var result map[string]*objectInfoEntry
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse object_info: %w", err)
	}
	return result, nil
}

func (p *ComfyUIProvider) CancelPrompt(ctx context.Context, apiKey, baseURL, promptID string) error {
	body := map[string]any{"delete": []string{promptID}}
	jsonData, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/queue", bytes.NewReader(jsonData))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	resp, err := providerHTTPClient.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}
