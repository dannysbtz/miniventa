package com.miniventa.app;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;

@CapacitorPlugin(name = "DeviceIdentity")
public class DeviceIdentityPlugin extends Plugin {
    private static final String KEY_ALIAS = "miniventa-device-identity-v1";

    @PluginMethod
    public void getPublicKey(PluginCall call) {
        try {
            KeyStore store = loadStore();
            if (!store.containsAlias(KEY_ALIAS)) generateKeyPair();
            byte[] encoded = store.getCertificate(KEY_ALIAS).getPublicKey().getEncoded();
            String pem = "-----BEGIN PUBLIC KEY-----\n"
                + Base64.encodeToString(encoded, Base64.NO_WRAP)
                .replaceAll("(.{64})", "$1\n")
                + "\n-----END PUBLIC KEY-----";
            JSObject result = new JSObject();
            result.put("publicKey", pem);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudo abrir la identidad segura del dispositivo", error);
        }
    }

    @PluginMethod
    public void sign(PluginCall call) {
        String value = call.getString("value");
        if (value == null || value.length() > 4096) {
            call.reject("Texto de firma inválido");
            return;
        }
        try {
            KeyStore store = loadStore();
            if (!store.containsAlias(KEY_ALIAS)) {
                call.reject("La identidad segura del dispositivo no está inicializada");
                return;
            }
            Signature signer = Signature.getInstance("SHA256withECDSA");
            signer.initSign((java.security.PrivateKey) store.getKey(KEY_ALIAS, null));
            signer.update(value.getBytes(StandardCharsets.UTF_8));
            String proof = Base64.encodeToString(signer.sign(), Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
            JSObject result = new JSObject();
            result.put("proof", proof);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudo firmar con la identidad segura del dispositivo", error);
        }
    }

    private KeyStore loadStore() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        return store;
    }

    private void generateKeyPair() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
        generator.initialize(new KeyGenParameterSpec.Builder(KEY_ALIAS,
            KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
            .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(false)
            .build());
        generator.generateKeyPair();
    }
}