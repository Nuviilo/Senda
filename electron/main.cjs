const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain } = require('electron');
const path = require('path');

// Replace this with your published Senda server URL before building the .exe
const SENDA_URL = process.env.SENDA_SERVER_URL || 'https://ais-pre-4y2jiuwmta4pj6mpnsngwt-646622080348.asia-southeast1.run.app';

let mainWindow = null;
let tray = null;
let isQuitting = false;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function getIconPath() {
  return path.join(__dirname, '..', 'public', 'senda-icon-256.png');
}

function createTray() {
  const icon = nativeImage.createFromPath(getIconPath()).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Senda — Universal File Transfer');

  const updateMenu = () => {
    const loginSettings = app.getLoginItemSettings();
    const menu = Menu.buildFromTemplate([
      {
        label: 'Open Senda',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        label: 'Start on Windows Startup',
        type: 'checkbox',
        checked: loginSettings.openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked });
          updateMenu();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit Senda',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(menu);
  };

  updateMenu();
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    title: 'Senda',
    icon: getIconPath(),
    autoHideMenuBar: true,
    backgroundColor: '#0B0D11',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(SENDA_URL);

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(SENDA_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Keep running in system tray for background transfers when closed
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

ipcMain.on('senda:set-startup', (_event, enabled) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
});

app.whenReady().then(() => {
  app.setAppUserModelId('app.senda.transfer');
  createWindow();
  createTray();
});

app.on('before-quit', () => {
  isQuitting = true;
});
