import debug, { Debugger } from 'debug';
import {
  BrowserView,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
} from 'electron';
import Events from 'events';
import fs from 'fs-extra';
import Event from './event';
import { Display, getAllDisplays } from './getDisplay';
import padStart from './padStart';
import { Bounds, ScreenshotsData } from './preload';

export type LoggerFn = (...args: unknown[]) => void;
export type Logger = Debugger | LoggerFn;

export interface Lang {
  magnifier_position_label?: string;
  operation_ok_title?: string;
  operation_cancel_title?: string;
  operation_save_title?: string;
  operation_redo_title?: string;
  operation_undo_title?: string;
  operation_mosaic_title?: string;
  operation_text_title?: string;
  operation_brush_title?: string;
  operation_arrow_title?: string;
  operation_ellipse_title?: string;
  operation_rectangle_title?: string;
}

export interface ScreenshotsOpts {
  lang?: Lang;
  logger?: Logger;
  /** 是否复用一个BrowserWindow（只隐藏不销毁），默认为false */
  // singleWindow?: boolean;
  /** 是否启用多屏幕截图，默认为true */
  // enableMultiScreen?: boolean;
}

export { Bounds };

// TODO:
// 2. 鼠标在两个屏幕间变化时需要页面及时响应下
// 3. 只允许同时在一个屏幕上截图
// 4. 启动截屏响应太慢的问题

export default class Screenshots extends Events {
  // 截图窗口 - 每个屏幕一个窗口
  private wins: Map<number, BrowserWindow> = new Map();

  // 截图窗口内容 - 每个屏幕单独加载
  private views: Map<number, BrowserView> = new Map();

  // 窗口截图数据
  private captureImgData: Map<number, string> = new Map();

  // 屏幕数据
  private displays: Map<number, Display> = new Map();

  private logger: Logger;

  // private singleWindow: boolean;

  private lang: Lang | null = null;

  // 是否启用多屏幕截图
  // private enableMultiScreen: boolean;

  // 当前允许交互的屏幕id
  private activeDisplayId: number | null = null;

  // 已准备好的displayId
  private readiedDisplayIds: Set<number> = new Set();

  constructor(opts?: ScreenshotsOpts) {
    super();

    this.listenIpc();

    this.logger = opts?.logger || debug('electron-screenshots');
    // this.singleWindow = opts?.singleWindow || false;
    // this.enableMultiScreen = opts?.enableMultiScreen || true;
    this.lang = opts?.lang || null;
  }

  /**
   * 开始截图 - 支持多屏幕
   */
  public async startCapture(): Promise<void> {
    this.logger('startCapture');

    const displays: Display[] = getAllDisplays();

    // if (this.enableMultiScreen) {
    //   displays = getAllDisplays();
    // } else {
    //   displays = [getCursorDisplay()];
    // }

    console.log('startCapture==>> displays', displays);

    for (let i = 0; i < displays.length; i++) {
      const display = displays[i];
      this.displays.set(display.id, display);

      // 确保先拿到截图数据再渲染页面，否则页面触发ready事件时可能拿不到截图数据
      const captureData = await this.capture(display);
      console.log(
        'startCapture==>> captureData',
        display.id,
        captureData?.length,
      );
      this.captureImgData.set(display.id, captureData);

      // kiosk是系统级的设置，只设置一次，设置多次会导致退不出的问题
      await this.createWindow(display, i === 0);
    }
  }

  /**
   * 结束截图
   */
  public async endCapture(): Promise<void> {
    this.logger('endCapture');

    await this.reset();

    if (!this.wins.size) {
      return;
    }

    const entriesArr = Array.from(this.wins.entries());

    for (const [displayId, win] of entriesArr) {
      console.log('endCapture==>>', displayId);
      win.setKiosk(false);
      win.blur();
      win.blurWebView();
      win.unmaximize();

      const view = this.views.get(displayId);

      if (view) {
        win.removeBrowserView(view);
        this.views.delete(displayId);
      }

      win.destroy();
      this.wins.delete(displayId);

      // if (this.singleWindow) {
      //   win.hide();
      // } else {
      // }
    }

    this.captureImgData.clear();
    this.displays.clear();
    this.readiedDisplayIds.clear();
  }

  private async reset(displayId?: number) {
    const views = Array.from(this.views.entries());
    // 通知页面重置截图区域
    views.forEach(([id, view]) => {
      if (!displayId || displayId === id) {
        view.webContents.send('SCREENSHOTS:reset');
      }
    });

    this.activeDisplayId = null;
  }

  /**
   * 初始化窗口
   */
  private async createWindow(
    display: Display,
    enableKiosk = false,
  ): Promise<void> {
    // 重置截图区域
    await this.reset(display.id);

    // const oldWin = this.wins.get(display.id);

    try {
      // 之前的窗口不存在或被销毁了，重新创建新窗口
      // if (!oldWin || oldWin.isDestroyed?.()) {
      const windowTypes: Record<string, string | undefined> = {
        darwin: undefined,
        linux: undefined,
        win32: 'toolbar',
      };

      // 先让页面加载
      const newView = new BrowserView({
        webPreferences: {
          preload: require.resolve('./preload.js'),
          nodeIntegration: false,
          contextIsolation: true,
          additionalArguments: [`--display-id=${display.id}`],
        },
      });
      newView.webContents.loadURL(
        `file://${require.resolve(
          '@shotz/react-screenshots/electron/electron.html',
        )}`,
      );

      // 添加控制台消息监听
      newView.webContents.on(
        'console-message',
        (event, level, message, line, sourceId) => {
          console.log(
            `Console [${level}] from display ${display.id}:`,
            message,
            `(${sourceId}:${line})`,
          );
        },
      );

      const newWin = new BrowserWindow({
        title: 'screenshots',
        x: display.x,
        y: display.y,
        width: display.width,
        height: display.height,
        useContentSize: true,
        type: windowTypes[process.platform],
        frame: false,
        show: false,
        autoHideMenuBar: true,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        // focusable 必须设置为 true, 否则窗口不能及时响应esc按键，输入框也不能输入
        focusable: true,
        skipTaskbar: true,
        alwaysOnTop: true,
        /**
         * linux 下必须设置为false，否则不能全屏显示在最上层
         * mac 下设置为false，否则可能会导致程序坞不恢复问题，且与 kiosk 模式冲突
         */
        fullscreen: false,
        // mac fullscreenable 设置为 true 会导致应用崩溃
        fullscreenable: false,
        kiosk: enableKiosk,
        // 这个透明度是和截图页面相同的透明度，为了立刻给用户反馈，避免让用户感觉有点延迟
        backgroundColor: '#4D000000',
        titleBarStyle: 'hidden',
        hasShadow: false,
        paintWhenInitiallyHidden: false,
        // mac 特有的属性
        roundedCorners: false,
        enableLargerThanScreen: false,
        acceptFirstMouse: true,
      });

      newWin.setIgnoreMouseEvents(false);
      newWin.setBrowserView(newView);

      // 适定平台
      if (process.platform === 'darwin') {
        newWin.setWindowButtonVisibility(false);
      }

      if (process.platform !== 'win32') {
        newWin.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
          skipTransformProcessType: true,
        });
      }

      newWin.setBounds(display);
      newWin.setAlwaysOnTop(true);

      newWin.on('closed', () => {
        console.log('windowClosed==>', display.id);
        this.logger('windowClosed', display.id);
        this.wins.delete(display.id);
        this.views.delete(display.id);
      });

      newView.setBounds({
        x: 0,
        y: 0,
        width: display.width,
        height: display.height,
      });

      this.emit('windowCreated', display.id, newWin);

      this.views.set(display.id, newView);
      this.wins.set(display.id, newWin);

      newWin.show();
      // return;
      // }

      // 暂时保留
      // oldWin.show();
    } catch (error) {
      console.log('createWindow error', error);
      throw error;
    }
  }

  // 截取屏幕 - 保持原来的逻辑
  private async capture(display: Display): Promise<string> {
    this.logger('SCREENSHOTS:capture');

    try {
      const startCapture = Date.now();
      console.log('startCapture time==>>', startCapture);

      const { Monitor } = await import('node-screenshots');
      const monitor = Monitor.fromPoint(
        display.x + display.width / 2,
        display.y + display.height / 2,
      );

      if (!monitor) {
        throw new Error(`Monitor.fromDisplay(${display.id}) get null`);
      }

      const image = await monitor.captureImage();
      const buffer = await image.toPng(true);
      console.log('Capture consume time==>', Date.now() - startCapture);
      return `data:image/png;base64,${buffer.toString('base64')}`;
    } catch (err) {
      this.logger('SCREENSHOTS:capture Monitor capture() error %o', err);

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: display.width * display.scaleFactor,
          height: display.height * display.scaleFactor,
        },
      });

      let source;
      if (sources.length === 1) {
        [source] = sources;
      } else {
        source = sources.find(
          (item) => item.display_id === display.id.toString()
            || item.id.startsWith(`screen:${display.id}:`),
        );
      }

      if (!source) {
        this.logger(
          "SCREENSHOTS:capture Can't find screen source. sources: %o, display: %o",
          sources,
          display,
        );
        throw new Error("Can't find screen source");
      }

      return source.thumbnail.toDataURL();
    }
  }

  /**
   * 设置语言
   */
  public async setLang(displayId: number): Promise<void> {
    this.logger('setLang: o%', {
      displayId,
      lang: this.lang,
    });
    const targetView = this.views.get(displayId);
    if (targetView) {
      targetView.webContents.send('SCREENSHOTS:setLang', this.lang);
    }
  }

  // 处理截图页面准备好之后的事情
  private handleScreenshotReady(displayId: number) {
    // console.log(
    //   'handleScreenshotReady==>',
    //   displayId,
    //   this.readiedDisplayIds.has(displayId),
    // );
    if (!displayId || this.readiedDisplayIds.has(displayId)) {
      return;
    }

    this.readiedDisplayIds.add(displayId);
    this.setLang(displayId);

    const targetView = this.views.get(displayId);
    const targetDisplay = this.displays.get(displayId);
    const captureData = this.captureImgData.get(displayId);

    if (targetView && targetDisplay && captureData) {
      targetView.webContents.send(
        'SCREENSHOTS:capture',
        targetDisplay,
        captureData,
      );
    }
  }

  private handleActiveDisplayIdChange() {
    const views = Array.from(this.views.values());
    views.forEach((view) => {
      view.webContents.send(
        'SCREENSHOTS:activeDisplayIdChange',
        this.activeDisplayId,
      );
    });
  }

  /**
   * 绑定ipc时间处理 - 保持原来的逻辑
   */
  private listenIpc(): void {
    /**
     * 某个屏幕正在截图
     */
    ipcMain.on('SCREENSHOTS:activate', (e, displayId: number) => {
      this.logger('SCREENSHOTS:activate', displayId);
      this.activeDisplayId = displayId;
      this.handleActiveDisplayIdChange();
    });
    /**
     * 截图窗口已准备事件
     */
    ipcMain.on('SCREENSHOTS:ready', (e, displayId: number) => {
      console.log('ipcMain.on SCREENSHOTS:ready');
      this.handleScreenshotReady(displayId);
    });
    /**
     * OK事件
     */
    ipcMain.on('SCREENSHOTS:ok', (e, buffer: Buffer, data: ScreenshotsData) => {
      this.logger(
        'SCREENSHOTS:ok buffer.length %d, data: %o',
        buffer.length,
        data,
      );

      if (this.activeDisplayId === null) return;

      const event = new Event();
      this.emit('ok', event, buffer, data);
      if (event.defaultPrevented) {
        return;
      }
      clipboard.writeImage(nativeImage.createFromBuffer(buffer));
      this.endCapture();
    });

    /**
     * CANCEL事件
     */
    ipcMain.on('SCREENSHOTS:cancel', () => {
      this.logger('SCREENSHOTS:cancel');

      const event = new Event();
      this.emit('cancel', event);
      if (event.defaultPrevented) {
        return;
      }
      this.endCapture();
    });

    /**
     * SAVE事件
     */
    ipcMain.on(
      'SCREENSHOTS:save',
      async (e, displayId: number, buffer: Buffer, data: ScreenshotsData) => {
        this.logger(
          'SCREENSHOTS:save displayId %d buffer.length %d, data: %o',
          displayId,
          buffer.length,
          data,
        );

        if (this.activeDisplayId === null) return;

        const event = new Event();
        this.emit('save', event, buffer, data);
        if (event.defaultPrevented || !this.wins.size) {
          return;
        }

        const time = new Date();
        const year = time.getFullYear();
        const month = padStart(time.getMonth() + 1, 2, '0');
        const date = padStart(time.getDate(), 2, '0');
        const hours = padStart(time.getHours(), 2, '0');
        const minutes = padStart(time.getMinutes(), 2, '0');
        const seconds = padStart(time.getSeconds(), 2, '0');
        const milliseconds = padStart(time.getMilliseconds(), 3, '0');

        // 在哪个页面触发就在哪个页面打开对话框
        const targetWin = this.wins.get(displayId);
        if (!targetWin) {
          return;
        }
        targetWin.setAlwaysOnTop(false);

        const { canceled, filePath } = await dialog.showSaveDialog(targetWin, {
          defaultPath: `${year}${month}${date}${hours}${minutes}${seconds}${milliseconds}.png`,
          filters: [
            { name: 'Image (png)', extensions: ['png'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });

        this.emit('afterSave', new Event(), buffer, data, false);

        targetWin.setAlwaysOnTop(true);
        if (canceled || !filePath) {
          this.emit('afterSave', new Event(), buffer, data, false);
          this.endCapture();
          return;
        }

        await fs.writeFile(filePath, buffer);
        this.emit('afterSave', new Event(), buffer, data, true);
        this.endCapture();
      },
    );
  }
}
