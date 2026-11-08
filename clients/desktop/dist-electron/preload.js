import { contextBridge as n, ipcRenderer as e } from "electron";
const r = {
  listCards: () => e.invoke("cards:list"),
  createCard: (t, a) => e.invoke("cards:create", t, a),
  updateCard: (t, a, s) => e.invoke("cards:update", t, a, s),
  deleteCard: (t) => e.invoke("cards:delete", t),
  search: (t, a) => e.invoke("cards:search", t, a),
  listTags: () => e.invoke("tags:list"),
  getSettings: () => e.invoke("settings:get"),
  saveSettings: (t) => e.invoke("settings:save", t),
  runSync: () => e.invoke("sync:run"),
  listShareTemplates: () => e.invoke("share:templates"),
  generateShareImage: (t, a) => e.invoke("share:generate", t, a),
  getMeta: () => e.invoke("meta:get")
};
n.exposeInMainWorld("maodou", r);
