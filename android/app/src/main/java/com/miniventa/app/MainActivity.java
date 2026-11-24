package com.miniventa.app;

import com.getcapacitor.BridgeActivity;
import com.miniventa.app.DeviceIdentityPlugin;

public class MainActivity extends BridgeActivity {
	@Override
	public void onCreate(android.os.Bundle savedInstanceState) {
		registerPlugin(DeviceIdentityPlugin.class);
		registerPlugin(BluetoothPrinterPlugin.class);
		super.onCreate(savedInstanceState);
	}
}
