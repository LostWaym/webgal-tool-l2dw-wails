package main

import (
	"embed"
	"net/http"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

// editorFlag 标记当前进程是否以"模型编辑器"模式启动。
// 主进程启动时不会带此 flag；子进程（由 App.OpenEditor 拉起）会带。
var editorFlag bool

// editorWmdlPath 由 --wmdl 参数携带；编辑器进程启动时若非空，会自动加载该 wmdl 文件。
var editorWmdlPath string

// hasFlag 手动扫描 os.Args，避免引入 flag 包带来的额外输出副作用。
func hasFlag(args []string, name string) bool {
	for _, a := range args {
		if a == name {
			return true
		}
	}
	return false
}

// hasValue 返回 name 紧跟的下一个参数值；name 不存在或没有值时返回空串。
func hasValue(args []string, name string) string {
	for i, a := range args {
		if a == name && i+1 < len(args) {
			return args[i+1]
		}
	}
	return ""
}

func main() {
	editorFlag = hasFlag(os.Args[1:], "--editor")
	editorWmdlPath = hasValue(os.Args[1:], "--wmdl")

	app := NewApp()

	// Middleware that routes /abs_files/<abs-path> requests to our local
	// file handler, then falls back to the embedded frontend bundle.
	localMW := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if len(r.URL.Path) >= len("/abs_files/") && r.URL.Path[:len("/abs_files/")] == "/abs_files/" {
				app.ServeFile(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}

	// 根据启动模式选择窗口标题、尺寸与窗口选项
	title := "L2DW"
	width, height := 1280, 800
	var winOpts *windows.Options
	if editorFlag {
		title = "L2DW - 模型编辑器"
		width, height = 1400, 900
		winOpts = &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
		}
	}

	err := wails.Run(&options.App{
		Title:            title,
		Width:            width,
		Height:           height,
		MinWidth:         900,
		MinHeight:        600,
		BackgroundColour: &options.RGBA{R: 24, G: 26, B: 32, A: 1},
		AssetServer: &assetserver.Options{
			Assets:     assets,
			Handler:    http.HandlerFunc(app.ServeFile),
			Middleware: assetserver.ChainMiddleware(localMW),
		},
		OnStartup: app.startup,
		Windows:   winOpts,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
