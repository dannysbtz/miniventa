package com.miniventa.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "BluetoothPrinter",
    permissions = {
        @Permission(alias = "bluetoothScan", strings = { Manifest.permission.BLUETOOTH_SCAN }),
        @Permission(alias = "bluetoothConnect", strings = { Manifest.permission.BLUETOOTH_CONNECT }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class BluetoothPrinterPlugin extends Plugin {
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final List<JSObject> discovered = new ArrayList<>();
    private BluetoothSocket socket;
    private String connectedName;
    private String connectedAddress;
    private BroadcastReceiver receiver;

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("connected", socket != null && socket.isConnected());
        result.put("name", connectedName);
        result.put("address", connectedAddress);
        call.resolve(result);
    }

    @PluginMethod
    public void getPairedDevices(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !hasPermission(Manifest.permission.BLUETOOTH_CONNECT)) {
            requestPermissionForAlias("bluetoothConnect", call, "pairedPermissionResult");
            return;
        }
        resolvePairedDevices(call);
    }

    @PermissionCallback
    private void pairedPermissionResult(PluginCall call) {
        resolvePairedDevices(call);
    }

    private void resolvePairedDevices(PluginCall call) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                call.reject("Este dispositivo no tiene Bluetooth.", "BLUETOOTH_UNAVAILABLE");
                return;
            }
            JSArray devices = new JSArray();
            for (BluetoothDevice device : adapter.getBondedDevices()) {
                devices.put(deviceInfo(device));
            }
            JSObject result = new JSObject();
            result.put("devices", devices);
            call.resolve(result);
        } catch (SecurityException exception) {
            call.reject("Permiso Bluetooth denegado.", "BLUETOOTH_PERMISSION_DENIED", exception);
        } catch (Exception exception) {
            call.reject("No se pudieron leer los dispositivos emparejados.", "BLUETOOTH_READ_FAILED", exception);
        }
    }

    @PluginMethod
    public void startScan(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !hasPermission(Manifest.permission.BLUETOOTH_SCAN)) {
            requestPermissionForAlias("bluetoothScan", call, "scanPermissionResult");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && !hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) {
            requestPermissionForAlias("location", call, "scanPermissionResult");
            return;
        }
        beginScan(call);
    }

    @PermissionCallback
    private void scanPermissionResult(PluginCall call) {
        String permission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            ? Manifest.permission.BLUETOOTH_SCAN
            : Manifest.permission.ACCESS_FINE_LOCATION;
        String alias = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? "bluetoothScan" : "location";
        if (!hasPermission(permission)) {
            String required = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                ? "Dispositivos cercanos (Buscar dispositivos Bluetooth)"
                : "Ubicación precisa (necesaria para escanear Bluetooth en esta versión de Android)";
            call.reject("Android no concedió el permiso «" + required + ". Revisa Ajustes > Aplicaciones > Miniventa > Permisos.", "BLUETOOTH_PERMISSION_DENIED");
            return;
        }
        beginScan(call);
    }

    private void beginScan(PluginCall call) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                call.reject("Este dispositivo no tiene Bluetooth.", "BLUETOOTH_UNAVAILABLE");
                return;
            }
            if (!adapter.isEnabled()) {
                call.reject("Activa Bluetooth en el teléfono para buscar impresoras.", "BLUETOOTH_DISABLED");
                return;
            }
            stopDiscovery(adapter);
            discovered.clear();
            receiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    String action = intent.getAction();
                    if (BluetoothDevice.ACTION_FOUND.equals(action)) {
                        BluetoothDevice device = getBluetoothDevice(intent);
                        if (device != null) emitDevice(device);
                    } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) {
                        notifyListeners("scanFinished", new JSObject());
                        unregisterReceiverSafely();
                    }
                }
            };
            IntentFilter filter = new IntentFilter(BluetoothDevice.ACTION_FOUND);
            filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                getContext().registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                getContext().registerReceiver(receiver, filter);
            }
            if (!adapter.startDiscovery()) {
                unregisterReceiverSafely();
                call.reject("No se pudo iniciar la búsqueda Bluetooth.", "BLUETOOTH_SCAN_FAILED");
                return;
            }
            JSObject result = new JSObject();
            result.put("scanning", true);
            call.resolve(result);
        } catch (SecurityException exception) {
            unregisterReceiverSafely();
            String required = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                ? "Dispositivos cercanos (BLUETOOTH_SCAN)"
                : "Ubicación precisa (ACCESS_FINE_LOCATION)";
            call.reject("Android denegó " + required + ". Revisa Ajustes > Aplicaciones > Miniventa > Permisos.", "BLUETOOTH_PERMISSION_DENIED", exception);
        }
    }

    @PluginMethod
    public void stopScan(PluginCall call) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter != null) stopDiscovery(adapter);
            unregisterReceiverSafely();
            call.resolve();
        } catch (SecurityException exception) {
            call.reject("No se pudo detener la búsqueda Bluetooth.", "BLUETOOTH_SCAN_FAILED", exception);
        }
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String address = call.getString("address");
        if (address == null || !BluetoothAdapter.checkBluetoothAddress(address)) {
            call.reject("Selecciona una impresora válida.", "BLUETOOTH_INVALID_DEVICE");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !hasPermission(Manifest.permission.BLUETOOTH_CONNECT)) {
            requestPermissionForAlias("bluetoothConnect", call, "connectPermissionResult");
            return;
        }
        connectDevice(call, address);
    }

    @PermissionCallback
    private void connectPermissionResult(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !hasPermission(Manifest.permission.BLUETOOTH_CONNECT)) {
            call.reject("Android no concedió Dispositivos cercanos (Bluetooth Connect). Revisa Ajustes > Aplicaciones > Miniventa > Permisos.", "BLUETOOTH_PERMISSION_DENIED");
            return;
        }
        connectDevice(call, call.getString("address"));
    }

    private void connectDevice(PluginCall call, String address) {
        if (address == null || !BluetoothAdapter.checkBluetoothAddress(address)) {
            call.reject("La dirección de impresora no es válida.", "BLUETOOTH_INVALID_DEVICE");
            return;
        }
        executor.execute(() -> {
            BluetoothSocket candidate = null;
            try {
                BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                if (adapter == null || !adapter.isEnabled()) throw new IOException("Activa Bluetooth en el teléfono.");
                stopDiscovery(adapter);
                BluetoothDevice device = adapter.getRemoteDevice(address);
                candidate = device.createRfcommSocketToServiceRecord(SPP_UUID);
                candidate.connect();
                closeSocket();
                socket = candidate;
                connectedAddress = device.getAddress();
                connectedName = device.getName();
                JSObject result = state();
                notifyListeners("connectionChanged", result);
                call.resolve(result);
            } catch (Exception exception) {
                if (candidate != null) {
                    try { candidate.close(); } catch (IOException ignored) { }
                }
                call.reject("No se pudo conectar. Verifica que la impresora esté emparejada y admita Bluetooth clásico SPP.", "BLUETOOTH_CONNECT_FAILED", exception);
            }
        });
    }

    @PluginMethod
    public void print(PluginCall call) {
        String encoded = call.getString("data");
        if (encoded == null || encoded.isEmpty() || encoded.length() > 32768) {
            call.reject("Los datos del ticket están vacíos o exceden el límite.", "BLUETOOTH_INVALID_PRINT_DATA");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !hasPermission(Manifest.permission.BLUETOOTH_CONNECT)) {
            requestPermissionForAlias("bluetoothConnect", call, "printPermissionResult");
            return;
        }
        printData(call, encoded);
    }

    @PermissionCallback
    private void printPermissionResult(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !hasPermission(Manifest.permission.BLUETOOTH_CONNECT)) {
            call.reject("Android no concedió el permiso Dispositivos cercanos (Bluetooth Connect).", "BLUETOOTH_PERMISSION_DENIED");
            return;
        }
        printData(call, call.getString("data"));
    }

    private void printData(PluginCall call, String encoded) {
        executor.execute(() -> {
            try {
                BluetoothSocket activeSocket = socket;
                if (activeSocket == null || !activeSocket.isConnected()) {
                    closeSocket();
                    connectedName = null;
                    connectedAddress = null;
                    notifyListeners("connectionChanged", state());
                    call.reject("No hay una impresora Bluetooth conectada.", "BLUETOOTH_NOT_CONNECTED");
                    return;
                }
                byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                if (bytes.length == 0 || bytes.length > 24576) {
                    call.reject("El ticket está vacío o es demasiado grande.", "BLUETOOTH_INVALID_PRINT_DATA");
                    return;
                }
                OutputStream output = activeSocket.getOutputStream();
                output.write(bytes);
                output.flush();
                JSObject result = state();
                result.put("bytesWritten", bytes.length);
                call.resolve(result);
            } catch (SecurityException exception) {
                call.reject("Android denegó el permiso Dispositivos cercanos para imprimir.", "BLUETOOTH_PERMISSION_DENIED", exception);
            } catch (IOException exception) {
                closeSocket();
                connectedName = null;
                connectedAddress = null;
                notifyListeners("connectionChanged", state());
                call.reject("Se perdió la conexión con la impresora durante la impresión.", "BLUETOOTH_PRINT_FAILED", exception);
            }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        closeSocket();
        connectedName = null;
        connectedAddress = null;
        JSObject result = state();
        notifyListeners("connectionChanged", result);
        call.resolve(result);
    }

    private void emitDevice(BluetoothDevice device) {
        try {
            JSObject info = deviceInfo(device);
            String address = info.getString("address");
            for (JSObject existing : discovered) {
                if (address.equals(existing.optString("address"))) return;
            }
            discovered.add(info);
            notifyListeners("deviceFound", info);
        } catch (Exception exception) {
            notifyListeners("scanError", new JSObject().put("message", "No se pudo leer un dispositivo encontrado."));
        }
    }

    private JSObject deviceInfo(BluetoothDevice device) throws Exception {
        JSObject item = new JSObject();
        String name = device.getName();
        item.put("name", name == null || name.trim().isEmpty() ? "Dispositivo Bluetooth" : name);
        item.put("address", device.getAddress());
        item.put("paired", device.getBondState() == BluetoothDevice.BOND_BONDED);
        return item;
    }

    private BluetoothDevice getBluetoothDevice(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice.class);
        }
        return intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
    }

    private JSObject state() {
        JSObject result = new JSObject();
        result.put("connected", socket != null && socket.isConnected());
        result.put("name", connectedName);
        result.put("address", connectedAddress);
        return result;
    }

    private void stopDiscovery(BluetoothAdapter adapter) {
        try {
            if (adapter.isDiscovering()) adapter.cancelDiscovery();
        } catch (SecurityException ignored) { }
    }

    private void closeSocket() {
        BluetoothSocket current = socket;
        socket = null;
        if (current != null) {
            try { current.close(); } catch (IOException ignored) { }
        }
    }

    private void unregisterReceiverSafely() {
        if (receiver == null) return;
        try { getContext().unregisterReceiver(receiver); } catch (IllegalArgumentException ignored) { }
        receiver = null;
    }

    @Override
    protected void handleOnDestroy() {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter != null) stopDiscovery(adapter);
        } catch (SecurityException ignored) { }
        unregisterReceiverSafely();
        closeSocket();
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}