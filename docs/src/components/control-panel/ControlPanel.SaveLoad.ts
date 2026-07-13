import { BinaryReader } from '@/utils/BinaryReader'
import { BinaryWriter } from '@/utils/BinaryWriter'
import MD5 from 'crypto-js/md5'
import { ref, shallowRef } from 'vue'
import { message, tryFocusChat } from './ControlPanel.Chat'
import { ProfileFile, clearFiles as ClearProfileFiles, u8ToBase64 } from './ControlPanel.Profiler'
import { command, commandIndex, tryFocusLogs } from './ControlPanel.Console'
import { resetEntities } from './ControlPanel.Entities'
import { activeSlot, beltSlots, clearInventory, hideInventory, mainSlots, wearSlots, onInventoryUpdate } from './ControlPanel.Inventory'
import { refreshPermissions } from './ControlPanel.Tabs.Permissions.vue'
import { loadingProfile, loadingToggle } from './ControlPanel.Profiler'
import { pluginThinking } from './ControlPanel.Plugins'

export const selectedServer = ref<Server | null>(null)
export const selectedSubTab = shallowRef<number>(0)
export const servers = ref<Server[]>([])
export const geoFlagCache = ref<{ [key: string]: string }>({})

const isLoadedServers = shallowRef<boolean>(false)

interface CommandSend {
  Message: string
  Identifier: number
}

interface CommandResponse {
  Message: string
  Identifier: number
  Type: LogType
  Stacktrace: string
}

// A dynamically spawned/moving entity (players, deployables, dropped items, etc.) tracked live via
// OnFakePlayerRPC — distinct from the static, once-loaded MapObjects prefab placement. `path` is
// resolved from PrefabPathsById (built from the same MapObjects response) when the id happens to
// match a known static prefab; otherwise Map3D falls back to a placeholder the same way it does for
// unresolved static prefabs.
export interface LiveEntity {
  entId: bigint
  prefabId: number
  path: string | null
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
}

enum LogType {
  Generic = 0,
  Error = 1,
  Warning = 2,
  Chat = 3,
  Report = 4,
  ClientPerf = 5,
  Subscription = 6,
}

export const md5 = (s: string) => String(md5FirstUint32LE(s))

export function md5FirstUint32LE(str: string): number {
  const wa = MD5(str)
  const w0 = wa.words[0] | 0
  const b0 = (w0 >>> 24) & 0xff
  const b1 = (w0 >>> 16) & 0xff
  const b2 = (w0 >>> 8) & 0xff
  const b3 = w0 & 0xff
  return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0
}

export async function fetchGeolocation(ip: string) {
  if (ip == '127.0.0.1') {
    return
  }

  const url = `https://api.iplocation.net/?ip=${ip.split(':')[0]}`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`IPAPI responded with status ${response.status}`)
    }

    const data = await response.json()
    if (geoFlagCache.value && !(ip in geoFlagCache.value)) {
      geoFlagCache.value[ip] = `https://flagcdn.com/32x24/${data.country_code2.toString().toLowerCase()}.png`
    }
  } catch (ex) {
    console.log(ex)
  }
}

export function isUsingHttps(): boolean {
  return location.protocol == 'https:'
}

export function createServer(address: string, password: string = '') {
  const server = new Server()
  server.Address = address
  server.Password = password
  return server
}

export function addServer(server: Server, shouldSelect: boolean = false) {
  servers.value.push(server)
  save()

  if (shouldSelect) {
    selectServer(server)
  }
}

export function hasServer(address: string, password: string): boolean {
  servers.value.forEach((server: Server) => {
    if (server.Address == address && server.Password == password) {
      return true
    }
  })
  return false
}

export function isValidUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const timeSince = ref<number>(performance.now())

export function deleteServer(server: Server, e: MouseEvent) {
  const confirmDelete = e.shiftKey || window.confirm(`Are you sure you want to delete server "${server.Address}"?`)
  if (confirmDelete) {
    const index = servers.value.indexOf(server)
    servers.value.splice(index, 1)
    if (selectedServer.value == server) {
      selectedServer.value = index > 0 ? servers.value[index - 1] : null
    }
  }
  save()
}

export function selectServer(server: Server) {
  if (!server) {
    console.log('Tried selecting a non-existent server')
    return
  }
  commandIndex.value = 0
  selectedServer.value?.clearMapEntityTracking()
  selectedServer.value = selectedServer.value == server ? null : server
  localStorage.setItem('rcon-lastserver', server.Address)
  refreshPermissions()
  resetEntities()
  tryFocusLogs(true)
  tryFocusChat(true)

  server.sendCall('ProfilesState')
  server.sendCall('ProfilesList')

  if(server.MapInfo == null) {
    server.sendCall('LoadMapInfo')
  }
  server.startMapEntityTracking()
}

export function findServer(address: string): Server {
  return servers.value.find((sv) => {
    if (sv.Address == address) {
      return sv
    }
  }) as Server
}

export function selectSubTab(index: number) {
  selectedSubTab.value = index
  localStorage.setItem('rcon-subtab', index.toString())
  save()

  switch (index) {
    case 0:
      tryFocusLogs(true)
      break
    case 1:
      tryFocusChat(true)
      break
  }
}

function exportToJson(): string {
  return JSON.stringify(servers.value, (key, value) => {
    switch (key) {
      case 'Socket':
      case 'UserConnected':
      case 'IsConnected':
      case 'ServerInfo':
      case 'CarbonInfo':
      case 'PlayerInfo':
      case 'SleeperInfo':
      case 'PluginsInfo':
      case 'MapInfo':
      case 'MapEntityUpdateInterval':
      case 'TerrainInfo':
      case 'MapObjects':
      case 'PrefabPathsById':
      case 'LiveEntities':
      case 'HeaderImage':
      case 'Description':
      case 'CommandCallbacks':
      case 'RpcCallbacks':
      case 'RpcPermissions':
      case 'ProfileFiles':
      case 'ProfileState':
      case 'Logs':
      case 'Chat':
      case 'Rpcs':
      case 'PendingRequest':
      case 'LastGlobalCommandResult':
        return undefined
    }
    return value
  })
}

export function exportSave() {
  const confirm = window.confirm(`Are you sure you wanna copy servers to clipboard?`)
  if (confirm) {
    navigator.clipboard.writeText(exportToJson())
  }
}

export function importSave() {
  const confirm = window.confirm(`Are you sure you wanna import and append the servers from the clipboard?`)
  if (confirm) {
    navigator.clipboard.readText().then((text) => {
      importFromJson(text)
    })
  }
}

export async function globalCommand() {
  const props = { title: 'Global Command', subtitle: 'Execute a command on all online servers in the list.', isLoading: ref<boolean>(false) }
  addPopup((await import(`@/components/control-panel/ControlPanel.Popup.GlobalCommand.vue`)).default, props)
}

export async function globalChatMessage() {
  const props = { title: 'Global Chat Message', subtitle: 'Prints a message across all selected servers.', isLoading: ref<boolean>(false) }
  addPopup((await import(`@/components/control-panel/ControlPanel.Popup.GlobaMessage.vue`)).default, props)
}

export function shiftServer(index: number, before: boolean) {
  const list = servers.value
  if (!list || index < 0 || index >= list.length) {
    return
  }
  const newIndex = before ? index - 1 : index + 1
  if (newIndex < 0 || newIndex >= list.length) {
    return
  }

  [list[index], list[newIndex]] = [list[newIndex], list[index]]
}

function importFromJson(data: string) {
  try {
    if (data) {
      ;(JSON.parse(data) as Server[]).forEach((server) => {
        if (hasServer(server.Address, server.Password)) {
          return
        }
        const localServer = createServer(server.Address, server.Password)
        localServer.AutoConnect = server.AutoConnect
        localServer.WideScreen = server.WideScreen
        localServer.Bridge = server.Bridge
        localServer.Secure = server.Secure
        localServer.ChatUsername = server.ChatUsername == null ? 'SERVER' : server.ChatUsername
        localServer.ChatUserId = server.ChatUserId
        localServer.ChatColor = server.ChatColor == null ? '#af5' : server.ChatColor
        localServer.CachedHostname = server.CachedHostname
        localServer.CommandHistory = server.CommandHistory ?? []
        localServer.ProfileFlags = server.ProfileFlags ?? new ProfileFlags()
        localServer.MapSettings = server.MapSettings
        localServer.LastGlobalCommand = server.LastGlobalCommand
        addServer(localServer)
      })

      setTimeout(() => {
        servers.value.forEach((server) => {
          if (server.AutoConnect) {
            server.connect()
          }
        })
      }, 250)
    }
  } catch (ex) {
    console.error(ex)
  }
}

export function save() {
  localStorage.setItem('rcon-servers', exportToJson())
}

export function load() {
  if (isLoadedServers.value) {
    return
  }

  isLoadedServers.value = true
  importFromJson(localStorage.getItem('rcon-servers') as string)

  const lastSelectedServer = localStorage.getItem('rcon-lastserver')
  if (lastSelectedServer) {
    selectServer(findServer(lastSelectedServer))
  }
  const subtab = localStorage.getItem('rcon-subtab')
  if (subtab) {
    selectSubTab(Number(subtab))
  }
}

const nextPopupId = ref<number>(0)

export const popups = ref<any[]>([]) 

export function addPopup(component: any, props?: Record<string, any>) {
  const id = nextPopupId.value++
  const mergedProps = { ...(props ?? {}), id }
  popups.value.push({ component, props: mergedProps })
}

export function getPopup(id: number) {
  return popups.value.find(p => p.props.id === id)
}

export function removePopup(id: number) {
  const popup = getPopup(id)
  if(popup != null && popup.props.onClosed != null) {
    popup.props.onClosed()
  }
  popups.value = popups.value.filter(p => p.props.id !== id)
}

export class Server {
  Address = ''
  Password = ''
  Socket: WebSocket | null = null
  Logs: string[] = []
  Chat: string[] = []
  LogsFilter: string | null = null
  CommandHistory: string[] = []
  AutoConnect = false
  WideScreen = false
  Secure = false
  Bridge = false
  CachedHostname = ''
  IsConnected = false
  IsConnecting = false
  UserConnected = false
  ServerInfo: any | null = null
  CarbonInfo: any | null = null
  PlayerInfo: any | null = null
  SleeperInfo: any | null = null
  PluginsInfo: any | null = null
  MapSettings: any = {}
  MapInfo: any | null = null
  MapEntityUpdateInterval: any | null = null
  TerrainInfo: any | null = null
  MapObjects: any[] | null = null
  // id -> path lookup built from MapObjects, used to resolve a real model for a live entity that
  // happens to share an id with an already-known static prefab (see OnFakePlayerRPC below).
  PrefabPathsById: Map<number, string> = new Map()
  // Dynamically spawned/moving entities tracked live via OnFakePlayerRPC, keyed by entity id.
  // Map3D renders these separately from MapObjects since they update far more frequently and in
  // far smaller numbers than the static placed-prefab set.
  LiveEntities: Map<bigint, LiveEntity> = new Map()
  HeaderImage = ''
  Description = ''
  ProfileFiles: ProfileFile[] = []
  ProfileState = new ProfileState()
  ProfileFlags = new ProfileFlags()
  CommandCallbacks: Record<number, (...args: unknown[]) => void> = {}
  RpcCallbacks: Record<number, (...args: unknown[]) => void> = {}
  RpcPermissions: any | null = []
  ChatUsername = 'SERVER'
  ChatUserId = '0'
  ChatColor = '#af5'
  PendingRequest = false
  LastGlobalCommand = ''
  LastGlobalCommandResult = ''

  formatDuration(seconds: number) {
    const hrs = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)

    const parts = []
    if (hrs > 0) parts.push(`${hrs}h`)
    if (mins > 0) parts.push(`${mins}m`)
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`)

    return parts.join(' ')
  }

  formatBytes(bytes: number, decimals = 2) {
    if (bytes === 0) return '0 B'

    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    const value = bytes / Math.pow(k, i)

    return `${parseFloat(value.toFixed(decimals))} ${sizes[i]}`
  }

  getDescription() {
    return this.Description.replaceAll('\\n', '<br>')
  }

  getAllPlayers() : any[] {
    return this.PlayerInfo?.concat(this.SleeperInfo)
  }

  getPlayer(steamId: bigint) {
    for (let i = 0; i < this.PlayerInfo.length; i++) {
      const player = this.PlayerInfo[i];
      if(player.SteamID == steamId) {
        return player
      }
    }
    for (let i = 0; i < this.SleeperInfo.length; i++) {
      const player = this.SleeperInfo[i];
      if(player.SteamID == steamId) {
        return player
      }
    }
  }

  hasPermission(permission: string) {
    if (permission in this.RpcPermissions) {
      return this.RpcPermissions[permission]
    }
    return true
  }

  clear() {
    this.IsConnecting = false
    this.IsConnected = false
    this.ServerInfo = null
    this.CarbonInfo = null
    this.PlayerInfo = null
    this.HeaderImage = ''
    this.Description = ''
    this.Socket = null
    this.CommandCallbacks = {}
    this.RpcCallbacks = {}
    this.RpcPermissions = {}
    this.ProfileFiles = []
    this.PrefabPathsById = new Map()
    this.LiveEntities = new Map()

    if (selectedServer.value == this) {
      hideInventory()
      tryFocusLogs()
      tryFocusChat()
    }
  }

  registerCommands() {
    this.CommandCallbacks = {}
  }

  registerRpcs() {
    this.setRpc('ServerInfo', (read) => {
      this.ServerInfo = {
        Hostname: read.string(),
        MaxPlayers: read.int32(),
        Players: read.int32(),
        Queued: read.int32(),
        Joining: read.int32(),
        ReservedSlots: read.int32(),
        EntityCount: read.int32(),
        GameTime: read.string(),
        Uptime: read.int32(),
        Map: read.string(),
        Framerate: read.float(),
        Memory: read.int32(),
        MemoryUsageSystem: read.int32(),
        Collections: read.int32(),
        NetworkIn: read.int32(),
        NetworkOut: read.int32(),
        Restarting: read.bool(),
        SaveCreatedTime: read.string(),
        Version: read.int32(),
        Protocol: read.string(),
      } as const
      this.CachedHostname = this.ServerInfo.Hostname
    })
    this.setRpc('CarbonInfo', (read) => {
      this.CarbonInfo = {
        Message: read.string(),
      }
    })
    this.setRpc('ServerDescription', (read) => {
      this.Description = read.string()
    })
    this.setRpc('ServerHeaderImage', (read) => {
      this.HeaderImage = read.string()
    })
    this.setRpc('SendPlayerInventory', (read) => {
      clearInventory()
      activeSlot.value = read.int32()
      this.readInventory(read, mainSlots)
      this.readInventory(read, beltSlots)
      this.readInventory(read, wearSlots)
      onInventoryUpdate.value()
    })
    this.setRpc('Players', (read) => {
      this.PlayerInfo = []
      this.SleeperInfo = []
      const playerCount = read.int32()
      for (let i = 0; i < playerCount; i++) {
        this.PlayerInfo.push(this.readPlayer(read))
      }
      this.PlayerInfo?.forEach((player: any) => {
        if (!(player.Address in geoFlagCache.value)) {
          fetchGeolocation(player.Address)
        }
      })
      const sleeperCount = read.int32()
      for (let i = 0; i < sleeperCount; i++) {
        this.SleeperInfo.push(this.readPlayer(read))
      }
    })
    this.setRpc('ConsoleTail', (read) => {
      const logs = []
      const logCount = read.int32()
      for (let i = 0; i < logCount; i++) {
        logs.push({
          Message: read.string(),
          Type: read.string(),
          Time: read.int32(),
        })
      }
      logs.forEach((log: any) => {
        this.appendLog(log.Message as string, new Date(log.Time * 1000))
      })
      tryFocusLogs(true)
    })
    this.setRpc('ConsoleLog', (read) => {
      const log = {
        Message: read.string(),
        Type: read.string(),
        Time: read.int32(),
      }
      this.appendLog(log.Message as string, new Date(log.Time * 1000))
      if(this.PendingRequest) {
        this.LastGlobalCommandResult = log.Message
        this.PendingRequest = false
      }
      tryFocusLogs()
    })
    this.setRpc('ChatTail', (read) => {
      const messages = []
      const messageCount = read.int32()
      for (let i = 0; i < messageCount; i++) {
        messages.push({
          Channel: read.int32(),
          Message: read.string(),
          UserId: read.string(),
          Username: read.string(),
          Color: read.string(),
          Time: read.int32()
        })
      }
      messages.forEach((log: any) => {
        this.appendChat(log)
      })
      tryFocusChat(true)
    })
    this.setRpc('ChatLog', (read) => {
      const message = {
          Channel: read.int32(),
          Message: read.string(),
          UserId: read.string(),
          Username: read.string(),
          Color: read.string(),
          Time: read.int32()
      }
      this.appendChat(message)
      tryFocusChat()
    })
    this.setRpc('AccountPermissions', (read) => {
      this.RpcPermissions['console_view'] = read.bool()
      this.RpcPermissions['console_input'] = read.bool()
      this.RpcPermissions['chat_view'] = read.bool()
      this.RpcPermissions['chat_input'] = read.bool()
      this.RpcPermissions['players_view'] = read.bool()
      this.RpcPermissions['players_ip'] = read.bool()
      this.RpcPermissions['players_inventory'] = read.bool()
      this.RpcPermissions['entities_view'] = read.bool()
      this.RpcPermissions['entities_edit'] = read.bool()
      this.RpcPermissions['permissions_view'] = read.bool()
      this.RpcPermissions['permissions_edit'] = read.bool()
      this.RpcPermissions['profiler_view'] = read.bool()
      this.RpcPermissions['profiler_load'] = read.bool()
      this.RpcPermissions['profiler_edit'] = read.bool()
      this.RpcPermissions['plugins_view'] = read.bool()
      this.RpcPermissions['plugins_edit'] = read.bool()
      this.RpcPermissions['map_view'] = read.bool()
      this.RpcPermissions['map_entities'] = read.bool()
      this.RpcPermissions['map_terrain'] = read.bool()
      this.RpcPermissions['map_data'] = read.bool()
      this.RpcPermissions['draw_ui'] = read.bool()
    })
    this.setRpc('ProfilesList', (read) => {
      ClearProfileFiles()
      const fileCount = read.int32()
      for (let i = 0; i < fileCount; i++) {
        const file = new ProfileFile()
        file.FilePath = read.string()
        file.FileName = read.string()
        file.Size = read.int64()
        file.LastWriteTime = read.int32()
        file.IsValid = read.bool()
        file.Protocol = read.int32()
        file.Duration = read.float()
        file.IsCompared = read.bool()
        this.ProfileFiles.push(file)
      }
    })
    this.setRpc('ProfilesLoad', (read) => {
      const name = read.string()
      const data = read.bytes(read.int32())
      localStorage.setItem('currentProfileName', `${name} — ${this.CachedHostname}`)
      localStorage.setItem('currentProfile', u8ToBase64(data))
      window.open('/tools/profiler-panel', '_blank', 'noopener,noreferrer');
      loadingProfile.value = null
    })
    this.setRpc('ProfilesState', (read) => {
      this.ProfileState.IsProfiling = read.bool()
      this.ProfileState.IsEnabled = read.bool()
      this.ProfileState.HasCrashed = read.bool()
      this.ProfileState.Duration = read.float()
      loadingToggle.value = null
    })
    this.setRpc('Plugins', (read) => {
      this.PluginsInfo = []
      const pluginsLength = read.int32()
      for (let i = 0; i < pluginsLength; i++) {
        this.PluginsInfo.push({
          Name: read.string(),
          FileName: read.string(),
          Version: read.string(),
          Author: read.string(),
          Description: read.string()
        })
      }
      const unloadedPluginsLength = read.int32()
      for (let i = 0; i < unloadedPluginsLength; i++) {
        this.PluginsInfo.push({
          Name: read.string(),
          Version: "UNLOADED",
          Author: '',
          IsUnloaded: true
        })
      }
      const failedPluginsLength = read.int32()
      for (let i = 0; i < failedPluginsLength; i++) {
        const plugin = {
          Name: read.string(),
          Version: "FAILED"
        }
        const errorLength = read.int32()
        plugin.Errors = []
        plugin.Description = ''
        for (let e = 0; e < errorLength; e++) {
          const error = {
            Message: read.string(),
            Number: read.string(),
            Column: read.int32(),
            Line: read.int32()
          }
          plugin.Errors.push(error)
          plugin.Description += ` ${error.Message} @ line ${error.Line} (${error.Number})<br>`
        }   
        this.PluginsInfo.push(plugin)
      }
      pluginThinking.value = '' 
    })
    this.setRpc('LoadMapInfo', read => {
      this.MapInfo = {
        imageWidth: read.int32(),
        imageHeight: read.int32(),
        imageUrl: URL.createObjectURL(new Blob([read.bytes(read.int32())], { type: 'image/png' })),
        worldSize: read.int32(),
        availableTypes: Object.keys(MapEntityTypes).splice(Object.keys(MapEntityTypes).length / 2, Object.keys(MapEntityTypes).length),
        entities: [],
        monuments: []
      }
      const monumentCount = read.int32()
      for (let i = 0; i < monumentCount; i++) {
        this.MapInfo.monuments.push({
          label: read.string(),
          x: read.float(),
          y: read.float()
        })
      }
      if(this.MapSettings == null) {
        this.MapSettings = {}
      }
      if(this.MapSettings.trackedTypes == null) {
        this.MapSettings.trackedTypes = []
      }
    })
    this.setRpc('RequestMapEntities', read => {
      if(performance.now() - timeSince.value > 20000) {
        timeSince.value = performance.now()
        this.MapInfo.entities.length = 0
      }
      const entityCount = read.int32()
      const batch = []
      for (let i = 0; i < entityCount; i++) {
        const entity = {}
        entity.type = read.int32()
        entity.entId = read.uint64()
        if(read.bool()) {
          entity.label = read.string()
        }
        entity.x = read.float()
        entity.y = read.float()
        batch.push(entity)
      }
      this.MapInfo.hour = read.float()

      for (let i = 0; i < batch.length; i++) {
        const element = batch[i];
        const existentEntity = this.MapInfo.entities.find((x: any) => x.entId == element.entId)
        if(existentEntity != null) {
          if(existentEntity.label != element.label) {
            existentEntity.label = element.label
          }
          if(existentEntity.type != element.type) {
            existentEntity.type = element.type
          }
          if(existentEntity.x != element.x) {
            existentEntity.x = element.x
          }
          if(existentEntity.y != element.y) {
            existentEntity.y = element.y
          }  
        }
        else {
          this.MapInfo.entities.push(element)
        }
      }
    })
    this.setRpc('LoadTerrain', read => {
      try {
        const res = read.int32()
        const worldSize = read.int32()
        const positionY = read.float()
        const sizeY = read.float()
        const heightMapLength = read.int32()
        const heightMapBytes = read.bytes(heightMapLength)

        const heights = new Int16Array(heightMapLength / 2)
        const heightView = new DataView(heightMapBytes.buffer, heightMapBytes.byteOffset, heightMapBytes.byteLength)
        for (let i = 0; i < heights.length; i++) {
          heights[i] = heightView.getInt16(i * 2, true)
        }

        if (heights.length !== res * res) {
          console.error(`DeliverInitialWorld: heightmap length mismatch — expected ${res * res} texels (res=${res}) but got ${heights.length}. Terrain will likely render incorrectly or not at all.`)
        }

        this.TerrainInfo = {
          res,
          worldSize,
          positionY,
          sizeY,
          heights
        }
      } catch (ex) {
        console.error('DeliverInitialWorld: failed to parse response', ex)
      }
    })
    this.setRpc('LoadMap', read => {
      try {
        const count = read.int32()
        const prefabs = new Array(count)
        for (let i = 0; i < count; i++) {
          prefabs[i] = {
            category: read.string(),
            id: read.uint32(),
            path: read.string(),
            position: { x: read.float(), y: read.float(), z: read.float() },
            rotation: { x: read.float(), y: read.float(), z: read.float() },
            scale: { x: read.float(), y: read.float(), z: read.float() }
          }
          if(prefabs[i].path.includes('monuments/')) {
            console.log(prefabs[i])
          }
        }
        this.MapObjects = prefabs

        for (let i = 0; i < prefabs.length; i++) {
          if (prefabs[i].path) {
            this.PrefabPathsById.set(prefabs[i].id, prefabs[i].path)
          }
        }
      } catch (ex) {
        console.error('DeliverInitialMap: failed to parse response (likely a malformed prefab entry desyncing the reader)', ex)
      }
    })
    this.setRpc('SendFakePlayerSnapshot', read => {
      const entityCount = read.int32()
      for(let i = 0; i < entityCount; i++) {
          const entityid = read.uint64()
          const prefabid = read.uint32()
          const posX = read.float()
          const posY = read.float()
          const posZ = read.float()
          const rotX = read.float()
          const rotY = read.float()
          const rotZ = read.float()
          this.LiveEntities.set(entityid, {
            entId: entityid,
            prefabId: prefabid,
            path: this.PrefabPathsById.get(prefabid) ?? null,
            position: { x: posX, y: posY, z: posZ },
            rotation: { x: rotX, y: rotY, z: rotZ }
          })
      }
    })
    this.setRpc('LoadStringPool', read => {
      const count = read.int32()
      for(let i = 0; i < count; i++) {
        this.PrefabPathsById.set(read.uint32(), read.string())
      }
    })
    this.setRpc('OnFakePlayerRPC', read => {
      const packetId = read.byte() - 140
      switch(packetId) {
        case 9: // RPCMessage — not currently used for map entity tracking
        {
          const entityid = read.uint64()
          const rpcid = read.uint32()
          break
        }
        case 10: // EntityPosition
        {
          const entity = this.LiveEntities.get(read.uint64())
          if (entity) {
            entity.position.x = read.float()
            entity.position.y = read.float()
            entity.position.z = read.float()
            entity.rotation.x = read.float()
            entity.rotation.y = read.float()
            entity.rotation.z = read.float()
          }
          break
        }
        case 6: // Entity Destroyed — stop tracking it so Map3D removes it from the scene
        {
          const entityid = read.uint64()
          this.LiveEntities.delete(entityid)
          break
        }
        case 5: // Entity Spawned — starts tracking a new live entity
        {
          const entityid = read.uint64()
          const prefabid = read.uint32()
          const posX = read.float()
          const posY = read.float()
          const posZ = read.float()
          const rotX = read.float()
          const rotY = read.float()
          const rotZ = read.float()

          this.LiveEntities.set(entityid, {
            entId: entityid,
            prefabId: prefabid,
            path: this.PrefabPathsById.get(prefabid) ?? null,
            position: { x: posX, y: posY, z: posZ },
            rotation: { x: rotX, y: rotY, z: rotZ }
          })
          // console.log(`${this.PrefabPathsById.get(prefabid)}: ${prefabid} @ ${this.PrefabPathsById.size} known prefabs`)
          break
        }
        default:
        {
          console.log(packetId)
          break
        }
      }
    })
  }

  hasTrackedType(i: number) : boolean {
    return this.MapSettings.trackedTypes.includes(i)
  }

  toggleTrackedType(i: number) {
    this.MapInfo.entities.length = 0
    if(!this.hasTrackedType(i)) {
      this.MapSettings.trackedTypes.push(i)
    } else {
      this.MapSettings.trackedTypes = this.MapSettings.trackedTypes.filter(t => t !== i)
    }
    this.MapInfo.entities.length = 0
    this.startMapEntityTracking()
    save()
  }

  startMapEntityTracking() {
    this.clearMapEntityTracking()
    this.MapEntityUpdateInterval = setInterval(() => {
      if(this.MapInfo == null || this.MapSettings.trackedTypes == null) {
        return
      }
      const write = new BinaryWriter()
      write.int32(0)
      write.uint32(this.getId('RequestMapEntities'))
      write.int32(this.MapSettings.trackedTypes.length)
      for (let i = 0; i < this.MapSettings.trackedTypes.length; i++) {
        write.int32(this.MapSettings.trackedTypes[i])
      }
      this.Socket?.send(write.toArrayBuffer())
    }, 1000);
  }

  clearMapEntityTracking() {
    if(this.MapEntityUpdateInterval != null) {
      clearInterval(this.MapEntityUpdateInterval)
      this.MapEntityUpdateInterval = null
    }
  }
  

  readPlayer(read: any) {
    const player = {
      SteamID: read.uint64(),
      OwnerSteamID: read.uint64(),
      DisplayName: read.string(),
      Ping: read.int32(),
      Address: read.string(),
      EntityId: read.uint64(),
      ConnectedSeconds: read.int32(),
      ViolationLevel: read.float(),
      CurrentLevel: read.int32(),
      UnspentXp: read.int32(),
      Health: read.float()
    }
    player.HasTeam = read.bool()
    if(player.HasTeam) {
      player.Team = []
      player.TeamLeader = read.uint64()
      const teamLength = read.int32()
      for (let i = 0; i < teamLength; i++) {
        player.Team.push(read.uint64())
      }
    }
    return player
  }
  
  readInventory(read: any, inventory: any) {
    const count = read.int32()
    for (let i = 0; i < count; i++) {
      const item = this.readItem(read)
      const position = item.Position
      if (position == -1 || position >= inventory.value.length) {
        continue
      }
      const slot = inventory.value[position]
      slot.ItemId = item.ItemId
      slot.ShortName = item.ShortName
      slot.Amount = item.Amount
      slot.MaxCondition = item.MaxCondition
      slot.Condition = item.Condition
      slot.ConditionNormalized = item.ConditionNormalized
      slot.HasCondition = item.HasCondition
    }
  }

  readItem(read: BinaryReader) {
    return {
      ItemId: read.int32(),
      ShortName: read.string(),
      Amount: read.int32(),
      Position: read.int32(),
      MaxCondition: read.float(),
      Condition: read.float(),
      ConditionNormalized: read.float(),
      HasCondition: read.bool(),
    }
  }

  connect() {
    save()
    this.UserConnected = true
    if (this.Socket != null) {
      this.clearMapEntityTracking()
      this.Socket.close()
      this.Socket.onclose?.(
        new CloseEvent('close', {
          wasClean: true,
          code: 1000,
          reason: 'Manual close',
        })
      )
      this.UserConnected = false
      return
    }

    this.Socket = new WebSocket((this.Secure ? 'wss' : 'ws') + '://' + this.Address + '/' + this.Password)
    if (this.Bridge) {
      this.Socket.binaryType = 'arraybuffer'
    }
    this.IsConnecting = true

    this.Socket.onopen = () => {
      this.IsConnecting = false
      this.IsConnected = true

      this.registerCommands()
      this.registerRpcs()
      if (this.Bridge) {
        this.sendCall('ServerInfo')
        this.sendCall('CarbonInfo')
        this.sendCall('ServerDescription')
        this.sendCall('ServerHeaderImage')
        this.sendCall('Players')
        this.sendCall('Plugins')
        this.sendCall('ConsoleTail', 200)
        this.sendCall('ChatTail', 200)
        this.sendCall('AccountPermissions')
      } else {
        this.sendCommand('serverinfo', 2)
        this.sendCommand('console.tail', 7)
        this.sendCommand('c.version', 3)
        this.sendCommand('server.headerimage', 4)
        this.sendCommand('server.description', 5)
      }
    }
    this.Socket.onclose = () => {
      this.clear()
    }
    this.Socket.onerror = () => {
      this.UserConnected = false
    }
    this.Socket.onmessage = (event) => {
      if (this.Bridge) {
        let bytes: Uint8Array
        if (event.data instanceof ArrayBuffer) {
          bytes = new Uint8Array(event.data)
        }
        BinaryReader.totalReceived++
        const read = new BinaryReader(event.data)
        switch (read.int32()) {
          case 0:
            if (this.onIdentifiedRpc(read)) {
              return
            }
            break
        }
      } else {
        const resp: CommandResponse = JSON.parse(event.data)
        try {
          let isJson = false
          let jsonData = null

          try {
            jsonData = JSON.parse(resp.Message)
            isJson = true
          } catch {
            /* empty */
          }

          if (this.onIdentifiedCommand(resp.Identifier, jsonData ?? resp)) {
            return
          }
        } catch {
          /* empty */
        }

        const match = resp.Message.match(/^\[CHAT\]\s+(.+?)\[(\d+)\]\s+:\s+(.+)$/)
        if (match) {
          this.appendChat({
            Username: match[1],
            UserId: match[2],
            Message: match[3],
          })
          return
        }

        this.appendLog(resp.Message, new Date(Date.now()))
        tryFocusLogs()
      }
    }
  }

  fetchInventory(playerId: number) {
    this.sendCall('SendPlayerInventory', playerId)
  }

  sendCommand(input: string, id: number = 1) {
    if (!input) {
      return
    }

    if (this.Bridge) {
      this.sendCall('ConsoleInput', input)
    } else {
      if (this.Socket && this.IsConnected) {
        const packet: CommandSend = {
          Message: input,
          Identifier: id,
        }
        this.Socket.send(JSON.stringify(packet))
      }
    }

    if (input == command.value) {
      this.appendLog('<span style="color: var(--category-misc);"><strong>></strong></span> ' + input, new Date())
      command.value = ''
      commandIndex.value = 0

      if (this.CommandHistory.length == 0 || this.CommandHistory[this.CommandHistory.length - 1] != input) {
        this.CommandHistory.unshift(input)
      }
    }

    tryFocusLogs(false)
  }

  sendMessage(input: string, clearMessage: boolean = true) {
    if(input.trim() == '') {
      return
    }
    if(this.Bridge) {
      this.sendCall('ChatInput', this.ChatUsername, input, this.ChatColor, this.ChatUserId)
      if(this.PendingRequest) {
        this.LastGlobalCommandResult = 'Delivered'
        this.PendingRequest = false
      }
    } else { 
      this.sendCommand(`say ${input}`, 1)
    }
    this.appendChat({
      Message: input,
      Username: this.ChatUsername,
      UserId: this.ChatUserId,
      Color: this.ChatColor,
      Channel: 0,
      Time: Math.floor(Date.now() / 1000)
    })
    if (clearMessage) {
      message.value = ''
    }
  }

  getId(id: string): number {
    const idPrefix = this.Bridge ? 'RPC' : 'CMD'
    return Number.parseInt(md5(`${idPrefix}_${id}`))
  }

  setCommand(id: string, callback: (...args: unknown[]) => void) {
    this.CommandCallbacks[this.getId(id)] = callback
  }

  setRpc(id: string, callback: (...args: unknown[]) => void) {
    this.RpcCallbacks[this.getId(id)] = callback
  }

  sendCall(id: string, ...args: unknown[]) {
    if (this.Bridge) {
      const write = new BinaryWriter()
      write.int32(0)
      write.uint32(this.getId(id))
      for (let i = 0; i < args.length; i++) {
        const value = args[i]
        const type = typeof value
        switch (type) {
          case 'bigint':
            write.uint64(value as bigint)
            break
          case 'number':
            write.int32(value as number)
            break
          case 'string':
            write.string(value as string)
            break
          case 'boolean':
            write.bool(value as boolean)
            break
        }
      }
      this.Socket?.send(write.toArrayBuffer())
      BinaryWriter.totalSent++
    } else {
      for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        args[i] = `"${arg}"`
      }
      this.sendCommand(`c.webpanel.cmd ${this.getId(id)} ${args.join(' ')}`, 100)
    }
  }

  onIdentifiedCommand(id: number, data: any) {
    switch (id) {
      case 0: // Rust output
      case 1: // User input
        return false
      case 2: // serverinfo
        this.ServerInfo = data
        this.CachedHostname = this.ServerInfo?.Hostname
        break
      case 6: // playerinfo
        this.PlayerInfo = data
        this.PlayerInfo?.forEach((player: any) => {
          if (!(player.Address in geoFlagCache.value)) {
            fetchGeolocation(player.Address)
          }
        })
        break
      case 7: // console.tail
        data.forEach((log: any) => {
          this.appendLog(log.Message as string, log.Time)
        })
        tryFocusLogs(true)
        break
      case 8: // chat.tail
        data.forEach((log: any) => {
          this.appendChat(log)
        })
        tryFocusChat(true)
        break
      case 3: // carboninfo
        this.CarbonInfo = data
        break
      case 4: // headerimage
        this.HeaderImage = data.Message.toString().split(' ').slice(1, 2).join(' ').replace(/['"]/g, '')
        if (!isValidUrl(this.HeaderImage)) {
          this.HeaderImage = ''
        }
        break
      case 5: // description
        this.Description = data.Message.toString().split(' ').slice(1, 1000).join(' ').replace(/['"]/g, '')
        break
    }

    return true
  }

  onIdentifiedRpc(read: BinaryReader): boolean {
    const rpcId = read.uint32()
    if (rpcId in this.RpcCallbacks) {
      this.RpcCallbacks[rpcId](read)
    }
    return true
  }

  toggleAutoConnect() {
    this.AutoConnect = !this.AutoConnect
    save()
  }

  toggleWideScreen() {
    this.WideScreen = !this.WideScreen
    save()
  }

  toggleBridge() {
    this.Bridge = !this.Bridge
    save()
  }

  toggleSecure() {
    this.Secure = !this.Secure
    save()
  }

  appendLog(log: string, time: Date) {
    this.Logs.push(`<span class="text-gray-600 text-xs select-none">${time.toLocaleTimeString()}  </span>${log}`)
  }

  appendChat(message: any) {
    let channel = ""
    let channelColor = "text-zinc-500 text-xs"
    switch (message.Channel) {
      case 0:
        channel = "Global"
        break
      case 1:
        channel = "Team"
        channelColor = "text-[#af5] text-xs"
        break
      case 2:
        channel = "Server"
        break
      case 3:
        channel = "Cards"
        break
      case 4:
        channel = "Local"
        break
      case 5:
        channel = "Clan"
        channelColor = "text-[#cf3dff] text-xs"
        break
      case 6:
        channel = "ExternalDM"
        break
    }
    channel = channel.toUpperCase()

    this.Chat.push( `<span class="text-zinc-500 text-xs">${new Date(message.Time * 1000).toLocaleTimeString()}\t <span class="${channelColor}">${channel}</span> \t</span> <a style="color: ${message.Color}" href="http://steamcommunity.com/profiles/${message.UserId}" target="_blank">${message.Username}</a>: ${message.Message}`)
  }

  selectHistory(up: boolean) {
    if (up) {
      commandIndex.value++
    } else {
      commandIndex.value--
    }

    if (commandIndex.value > this.CommandHistory.length - 1) {
      commandIndex.value = -1
    } else if (commandIndex.value < -1) {
      commandIndex.value = this.CommandHistory.length - 1
    }

    if (commandIndex.value == -1) {
      command.value = ''
      return
    }

    if (this.CommandHistory.length > 0) {
      command.value = this.CommandHistory[commandIndex.value]
    }
  }

  clearLogs() {
    const confirmDelete = window.confirm(`Are you sure you want to clear all logs for "${this.Address}"?`)
    if (confirmDelete) {
      this.Logs = []
      this.CommandHistory = []
      save()
    }
  }
}

export class ProfileState {
  IsProfiling: boolean = false
  IsEnabled: boolean = false
  HasCrashed: boolean = false
  Duration = ref<number>(0)
}

export class ProfileFlags {
  CallMemory: boolean = true
  AdvancedMemory: boolean = true
  Timings: boolean = true
  Calls: boolean = true
  GCEvents: boolean = true
  StackWalkAllocations: boolean = true
}

export function getMapEntityTypeName(type: number) {
  switch(type) {
    case MapEntityTypes.ActivePlayers:
      return 'Online Players'
    case MapEntityTypes.SleepingPlayers:
      return 'Offline Players'
  }
}

export enum MapEntityTypes {
  ActivePlayers = 0,
  SleepingPlayers = 1
} 
