package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Slot keys for App.lastDirs. Use these constants instead of string literals
// when reading/writing the picker cache map.
const (
	slotModel      = "model"
	slotImage      = "image"
	slotMotion     = "motion"
	slotExpression = "expression"
	slotWmdl       = "wmdl"
)

// AppConfig stores persistent user preferences.
type AppConfig struct {
	LastDirs map[string]string `json:"lastDirs"`
}

// App is the Wails application struct exposed to the frontend.
type App struct {
	ctx context.Context

	mu sync.RWMutex

	configPath string            // absolute path of the config file
	lastDirs   map[string]string // slot key -> last directory used in picker
}

// NewApp creates a new App application struct.
func NewApp() *App {
	configDir, _ := os.UserConfigDir()
	configPath := filepath.Join(configDir, "L2DW", "config.json")
	return &App{
		configPath: configPath,
	}
}

// loadConfig reads the persisted config from disk.
func (a *App) loadConfig() AppConfig {
	data, err := os.ReadFile(a.configPath)
	if err != nil {
		return AppConfig{}
	}
	var cfg AppConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return AppConfig{}
	}
	return cfg
}

// saveConfig persists the config to disk.
func (a *App) saveConfig(cfg AppConfig) error {
	data, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(a.configPath), 0755); err != nil {
		return err
	}
	return os.WriteFile(a.configPath, data, 0644)
}

// snapshotConfig assembles the full AppConfig from the current state.
// Callers MUST hold a.mu for writing before invoking this; the returned value
// captures the current state of lastDirs for persistence.
func (a *App) snapshotConfig() AppConfig {
	return AppConfig{LastDirs: a.lastDirs}
}

// startup is called when the app starts. The context is saved so we can
// call runtime methods later.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	cfg := a.loadConfig()
	if cfg.LastDirs == nil {
		cfg.LastDirs = map[string]string{}
	}
	a.mu.Lock()
	a.lastDirs = cfg.LastDirs
	a.mu.Unlock()
}

// AppMode 暴露当前进程的窗口模式给前端，main.ts 据此决定挂载 App 还是 ModelEditApp。
// 返回 "editor" 表示编辑器模式，"main" 表示主窗口模式。
func (a *App) AppMode() string {
	if editorFlag {
		return "editor"
	}
	return "main"
}

// OpenEditor 异步 spawn 一个新的 L2DW 进程（带 --editor 参数），新进程会打开
// 独立的"模型编辑器"窗口。子进程在 main.go 启动时识别该 flag 后进入编辑器模式。
//
// 这里只 Start() 不 Wait()，避免阻塞主窗口的 UI 线程；新进程退出由 OS 回收。
// 不传 Stdin/Stdout/Stderr，避免子进程意外继承/阻塞主进程的 console。
func (a *App) OpenEditor() error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(self, "--editor")
	cmd.Stdin = nil
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Start()
}

type pickerKind int

const (
	pickerFile pickerKind = iota
	pickerDir
)

// runPicker opens a native file or directory dialog with the given options.
// On a successful non-empty selection it caches the chosen directory in
// a.lastDirs[slot] and persists the updated config.
func (a *App) runPicker(opts runtime.OpenDialogOptions, slot string, kind pickerKind) (string, error) {
	a.mu.RLock()
	defaultDir := a.lastDirs[slot]
	a.mu.RUnlock()

	if defaultDir != "" {
		if fi, err := os.Stat(defaultDir); err != nil || !fi.IsDir() {
			if exe, err := os.Executable(); err == nil {
				defaultDir = filepath.Dir(exe)
			} else {
				defaultDir = ""
			}
		}
	}
	opts.DefaultDirectory = defaultDir

	var path string
	var err error
	if kind == pickerDir {
		path, err = runtime.OpenDirectoryDialog(a.ctx, opts)
	} else {
		path, err = runtime.OpenFileDialog(a.ctx, opts)
	}
	if err != nil || path == "" {
		return path, err
	}

	dir := filepath.Dir(path)
	a.mu.Lock()
	a.lastDirs[slot] = dir
	cfg := a.snapshotConfig()
	a.mu.Unlock()
	a.saveConfig(cfg)
	return path, nil
}

// PickLive2DModel opens a native file dialog for choosing a Live2D model
// descriptor. Returns the absolute path the user picked, or "" if cancelled.
func (a *App) PickLive2DModel() (string, error) {
	return a.runPicker(
		runtime.OpenDialogOptions{
			Title: "Select Live2D Model",
			Filters: []runtime.FileFilter{
				{DisplayName: "Live2D Model", Pattern: "*.json"},
			},
		},
		slotModel, pickerFile,
	)
}

// PickImageFile opens a native file dialog for choosing an image file.
// Returns the absolute path the user picked, or "" if cancelled.
func (a *App) PickImageFile() (string, error) {
	return a.runPicker(
		runtime.OpenDialogOptions{
			Title: "Select Background Image",
			Filters: []runtime.FileFilter{
				{DisplayName: "Image Files", Pattern: "*.png;*.jpg;*.jpeg;*.webp"},
			},
		},
		slotImage, pickerFile,
	)
}

// PickMotionFile opens a native file dialog for choosing a single Live2D
// motion file (Cubism 2 .mtn / Cubism 3+ .motion3.json).
func (a *App) PickMotionFile() (string, error) {
	return a.runPicker(
		runtime.OpenDialogOptions{
			Title: "Select Motion File",
			Filters: []runtime.FileFilter{
				{DisplayName: "Motion", Pattern: "*.mtn;*.motion3.json"},
			},
		},
		slotMotion, pickerFile,
	)
}

// PickExpressionFile opens a native file dialog for choosing a single Live2D
// expression file (Cubism 2 .exp.json / Cubism 3+ .exp3.json).
func (a *App) PickExpressionFile() (string, error) {
	return a.runPicker(
		runtime.OpenDialogOptions{
			Title: "Select Expression File",
			Filters: []runtime.FileFilter{
				{DisplayName: "Expression", Pattern: "*.exp.json;*.exp3.json"},
			},
		},
		slotExpression, pickerFile,
	)
}

// PickDirectory opens a native directory-selection dialog.
// `kind` is "motion" or "expression" and determines which lastDir slot is used
// for DefaultDirectory and persistence. Returns the chosen directory, or "" if
// the user cancelled.
func (a *App) PickDirectory(kind string) (string, error) {
	switch kind {
	case "motion":
		return a.runPicker(runtime.OpenDialogOptions{Title: "Select Motion Folder"}, slotMotion, pickerDir)
	case "expression":
		return a.runPicker(runtime.OpenDialogOptions{Title: "Select Expression Folder"}, slotExpression, pickerDir)
	default:
		return "", fmt.Errorf("PickDirectory: unsupported kind %q (want \"motion\" or \"expression\")", kind)
	}
}

// ScannedEntry describes a motion or expression file discovered inside a
// scanned directory. absPath is the absolute path on disk; relPath is the
// POSIX-style path relative to modelDir (which is supplied by the frontend
// based on the current WmdlModelItem.jsonAbsPath) and is what should be
// stored on WmdlModelItem.motions / .expressions.
//
// SubFolders records the chain of subdirectory names (relative to `root`)
// that lead to this file, deepest folder last. Files directly under `root`
// produce an empty slice. The frontend uses it to force-check matching
// "path nodes" in the batch-add modal without exposing them as new UI items.
type ScannedEntry struct {
	Kind       string   `json:"kind"`       // "motion" | "expression"
	Name       string   `json:"name"`       // basename with extension stripped
	AbsPath    string   `json:"absPath"`    // absolute path on disk
	SubFolders []string `json:"subFolders"` // subfolder chain below scan root, deepest last
}

// GetFileModifyTime returns the file's last-modified time as Unix milliseconds.
// Used by the editor's texture hot-reload watcher to detect external edits to
// texture files. Returns 0 + error when the path does not exist or is unreadable.
func (a *App) GetFileModifyTime(path string) (int64, error) {
	if path == "" {
		return 0, fmt.Errorf("GetFileModifyTime: path is empty")
	}
	fi, err := os.Stat(path)
	if err != nil {
		return 0, err
	}
	return fi.ModTime().UnixMilli(), nil
}

// ListMotionAndExpressionFiles scans `dir` for Live2D motion and expression
// files:
//   - motion:    *.mtn (Cubism 2), *.motion3.json (Cubism 3/4)
//   - expression: *.exp.json (Cubism 2), *.exp3.json (Cubism 3/4)
//
// When `recursive` is true the scan walks into subdirectories; each returned
// entry's SubFolders slice contains the chain of folder names (relative to
// `dir`) that lead to the file, deepest folder last. When `recursive` is
// false the scan stops at `dir` and every entry has an empty SubFolders.
//
// Empty / unreadable files are skipped. Relative paths are computed on the
// frontend using `pathRelative(modelDir, absPath)`.
func (a *App) ListMotionAndExpressionFiles(dir string, recursive bool) ([]ScannedEntry, error) {
	if dir == "" {
		return nil, fmt.Errorf("ListMotionAndExpressionFiles: dir is empty")
	}
	return scanMotionAndExpression(dir, recursive)
}

func scanMotionAndExpression(dir string, recursive bool) ([]ScannedEntry, error) {
	motionExts := []string{".mtn", ".motion3.json"}
	exprExts := []string{".exp.json", ".exp3.json"}

	out := []ScannedEntry{}

	var walk func(current string, chain []string) error
	walk = func(current string, chain []string) error {
		entries, err := os.ReadDir(current)
		if err != nil {
			return err
		}
		for _, e := range entries {
			full := filepath.Join(current, e.Name())
			if e.IsDir() {
				if !recursive {
					continue
				}
				if err := walk(full, append(append([]string{}, chain...), e.Name())); err != nil {
					return err
				}
				continue
			}

			fi, err := e.Info()
			if err != nil || fi.Size() == 0 {
				continue
			}

			name := e.Name()
			lower := strings.ToLower(name)

			folderChain := append([]string{}, chain...)
			if matched, base := matchExt(lower, name, motionExts); matched {
				out = append(out, ScannedEntry{
					Kind:       "motion",
					Name:       base,
					AbsPath:    full,
					SubFolders: folderChain,
				})
				continue
			}
			if matched, base := matchExt(lower, name, exprExts); matched {
				out = append(out, ScannedEntry{
					Kind:       "expression",
					Name:       base,
					AbsPath:    full,
					SubFolders: folderChain,
				})
			}
		}
		return nil
	}

	if err := walk(dir, nil); err != nil {
		return nil, err
	}
	return out, nil
}

func matchExt(lower, name string, exts []string) (bool, string) {
	for _, ext := range exts {
		if strings.HasSuffix(lower, ext) {
			return true, name[:len(name)-len(ext)]
		}
	}
	return false, ""
}

// ServeFile serves an arbitrary file whose absolute path is embedded in the
// request URL. Used by the asset handler for the /abs_files/<abs-path> route.
//
// The frontend is expected to URL-encode the absolute path before placing it
// in the URL; we decode it here with url.PathUnescape so that paths containing
// spaces or non-ASCII characters (e.g. Chinese) survive the round-trip.
//
// No whitelist / sandbox check is performed: the frontend is trusted to ask
// for whatever file it needs.
func (a *App) ServeFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	const prefix = "/abs_files/"
	raw := r.URL.Path
	if !strings.HasPrefix(raw, prefix) {
		http.NotFound(w, r)
		return
	}
	encoded := strings.TrimPrefix(raw, prefix)
	if encoded == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}

	decoded, err := url.PathUnescape(encoded)
	if err != nil {
		http.Error(w, "bad path", http.StatusBadRequest)
		return
	}

	http.ServeFile(w, r, decoded)
}

// PickWmdlFile opens a native file dialog for choosing a .wmdl file.
func (a *App) PickWmdlFile() (string, error) {
	return a.runPicker(
		runtime.OpenDialogOptions{
			Title: "Select WMDL File",
			Filters: []runtime.FileFilter{
				{DisplayName: "WMDL File", Pattern: "*.wmdl"},
			},
		},
		slotWmdl, pickerFile,
	)
}

// SaveWmdlFileDialog opens a native save dialog for selecting the destination
// of a .wmdl file. Returns the chosen path, or an empty string if the user
// cancelled.
func (a *App) SaveWmdlFileDialog() (string, error) {
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:                "Save WMDL File",
		DefaultFilename:      "untitled.wmdl",
		CanCreateDirectories: true,
		Filters: []runtime.FileFilter{
			{DisplayName: "WMDL File", Pattern: "*.wmdl"},
		},
	})
}

// ReadWmdlFile reads the contents of a wmdl file.
func (a *App) ReadWmdlFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// SaveWmdlFile saves the given content to a wmdl file.
func (a *App) SaveWmdlFile(path string, content string) error {
	return os.WriteFile(path, []byte(content), 0644)
}

// ReadModelJsonFile reads the raw text content of a model descriptor json file
// (model.json / model3.json). Used by the editor to cache the original object
// so that subsequent saves can mutate and rewrite it without losing fields.
func (a *App) ReadModelJsonFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// SaveModelJsonFile writes the serialized model descriptor json content to the
// given absolute path. Path is not anchored to any sandbox; callers must pass
// an absolute path returned from a picker / save dialog.
func (a *App) SaveModelJsonFile(path string, content string) error {
	return os.WriteFile(path, []byte(content), 0644)
}

// SaveModelJsonFileDialog opens a native save dialog for selecting the
// destination of a model descriptor json file. The file filter is intentionally
// permissive (model.json / model3.json) so users can choose either format. If
// `currentPath` is provided, its directory is used as the default.
func (a *App) SaveModelJsonFileDialog(currentPath string) (string, error) {
	opts := runtime.SaveDialogOptions{
		Title:                "Save Model Descriptor JSON",
		DefaultFilename:      "model.json",
		CanCreateDirectories: true,
		Filters: []runtime.FileFilter{
			{DisplayName: "Model Descriptor", Pattern: "model.json;model3.json"},
		},
	}
	if currentPath != "" {
		if dir := filepath.Dir(currentPath); dir != "" {
			opts.DefaultDirectory = dir
		}
		if base := filepath.Base(currentPath); base != "" {
			opts.DefaultFilename = base
		}
	}
	return runtime.SaveFileDialog(a.ctx, opts)
}

// presetDir 返回预设目录的绝对路径。优先使用环境变量 L2DW_PART_PRESETS_DIR
// 覆盖；否则相对于可执行文件所在目录下的 assets/part_presets 解析；
// 解析失败时回退到当前工作目录下的 assets/part_presets。
func presetDir() string {
	if v := os.Getenv("L2DW_PART_PRESETS_DIR"); v != "" {
		return v
	}
	if exe, err := os.Executable(); err == nil {
		return filepath.Join(filepath.Dir(exe), "assets", "part_presets")
	}
	return filepath.Join("assets", "part_presets")
}

// ListPresetFiles 列出预设目录下所有 .txt 预设文件的 basename。
// 不存在的目录返回空切片（不报错），以便前端可以无感降级。
func (a *App) ListPresetFiles() ([]string, error) {
	dir := presetDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}
	out := []string{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(strings.ToLower(name), ".txt") {
			continue
		}
		out = append(out, name)
	}
	return out, nil
}

// ReadPresetFile 读取指定预设文件的内容。filename 必须是 ListPresetFiles
// 返回的 basename 之一，防止越界读取预设目录之外的文件。
func (a *App) ReadPresetFile(filename string) (string, error) {
	if filename == "" {
		return "", fmt.Errorf("ReadPresetFile: filename is empty")
	}
	if strings.ContainsAny(filename, "/\\") || strings.Contains(filename, "..") {
		return "", fmt.Errorf("ReadPresetFile: invalid filename %q", filename)
	}
	path := filepath.Join(presetDir(), filename)
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// SetClipboardText 将 text 写入系统剪贴板。
// 仅供主窗口的快捷键逻辑调用，统一对外屏蔽 Wails runtime 差异。
func (a *App) SetClipboardText(text string) error {
	return runtime.ClipboardSetText(a.ctx, text)
}
