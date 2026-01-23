/* Any copyright is dedicated to the Public Domain.
http://creativecommons.org/publicdomain/zero/1.0/ */

package org.mozilla.gecko.util;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.google.android.gms.fido.common.Transport;
import java.util.Arrays;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

@RunWith(RobolectricTestRunner.class)
public class WebAuthnUtilsTest {
  @Test
  public void responseJSONForMakeCredential() throws Exception {
    // attestationObject isn't valid format, but this unit test is that parsing JSON and building
    // parameters.
    final String responseJSON =
        "{"
            + "\"id\": \"AAECAwQFBgcICQoLDA0ODw\" ,"
            + "\"rawId\": \"AAECAwQFBgcICQoLDA0ODw\" ,"
            + "\"type\": \"public-key\" ,"
            + "\"authenticatorAttachment\": \"platform\", "
            + "\"response\": {\"attestationObject\": \"AQIDBAUGBwgJCgsMDQ4PEA\", \"transports\": [ \"internal\" ]},"
            + "\"clientExtensionResults\": {\"credProps\": {\"rk\": true } }"
            + "}";
    final WebAuthnUtils.MakeCredentialResponse response =
        WebAuthnUtils.getMakeCredentialResponse(responseJSON);

    final byte[] rawId =
        new byte[] {0x0, 0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8, 0x9, 0xa, 0xb, 0xc, 0xd, 0xe, 0xf};
    final byte[] attestationObject =
        new byte[] {
          0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8, 0x9, 0xa, 0xb, 0xc, 0xd, 0xe, 0xf, 0x10
        };
    assertTrue("rawId should be matched", Arrays.equals(response.keyHandle, rawId));
    assertTrue(
        "attestationObject should be matched",
        Arrays.equals(response.attestationObject, attestationObject));
    assertEquals("No clientDataJson in response", response.clientDataJson, null);
    assertTrue("handle credProps", response.credProps);
  }

  @Test(expected = JSONException.class)
  public void invalidMakeCredential() throws Exception {
    final String responseJSON =
        "{"
            + "\"type\": \"public-key\" ,"
            + "\"authenticatorAttachment\": \"platform\", "
            + "\"response\": {\"attestationObject\": \"AQIDBAUGBwgJCgsMDQ4PEA\", \"transports\": [ \"internal\" ]}"
            + "}";
    final WebAuthnUtils.MakeCredentialResponse response =
        WebAuthnUtils.getMakeCredentialResponse(responseJSON);
    assertTrue("Not reached", false);
  }

  @Test
  public void responseJSONForGetAssertion() throws Exception {
    // authenticatorData and signature aren't valid format, but this unit test is that parsing JSON
    // and building parameters.
    final String responseJSON =
        "{"
            + "\"id\": \"AAECAwQFBgcICQoLDA0ODw\" ,"
            + "\"rawId\": \"AAECAwQFBgcICQoLDA0ODw\" ,"
            + "\"authenticatorAttachment\": \"platform\", "
            + "\"response\": {\"authenticatorData\": \"AQIDBAUGBwgJCgsMDQ4PEA\", \"signature\": \"AgMEBQYHCAkKCwwNDg8QEQ\"}"
            + "}";
    final WebAuthnUtils.GetAssertionResponse response =
        WebAuthnUtils.getGetAssertionResponse(responseJSON);

    final byte[] rawId =
        new byte[] {0x0, 0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8, 0x9, 0xa, 0xb, 0xc, 0xd, 0xe, 0xf};
    final byte[] authData =
        new byte[] {
          0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8, 0x9, 0xa, 0xb, 0xc, 0xd, 0xe, 0xf, 0x10
        };
    final byte[] signature =
        new byte[] {
          0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8, 0x9, 0xa, 0xb, 0xc, 0xd, 0xe, 0xf, 0x10, 0x11
        };
    assertTrue("rawId should be matched", Arrays.equals(response.keyHandle, rawId));
    assertTrue("authenticatorData should be matched", Arrays.equals(response.authData, authData));
    assertTrue("signature should be matched", Arrays.equals(response.signature, signature));
    assertEquals(
        "authenticatorAttachment should be matched", response.authenticatorAttachment, "platform");
    assertEquals("No clientDataJson in response", response.clientDataJson, null);
  }

  @Test(expected = JSONException.class)
  public void invalidGetAssertion() throws Exception {
    final String responseJSON =
        "{"
            + "\"authenticatorAttachment\": \"platform\", "
            + "\"response\": {\"authenticatorData\": \"AQIDBAUGBwgJCgsMDQ4PEA\", \"signature\": \"AgMEBQYHCAkKCwwNDg8QEQ\"}"
            + "}";
    final WebAuthnUtils.GetAssertionResponse response =
        WebAuthnUtils.getGetAssertionResponse(responseJSON);
    assertTrue("Not reached", false);
  }

  @Test
  public void transportValue() throws Exception {
    final byte transports = 31;

    final List<Transport> expectedFidoTransports =
        Arrays.asList(
            Transport.USB,
            Transport.NFC,
            Transport.BLUETOOTH_LOW_ENERGY,
            Transport.INTERNAL,
            Transport.HYBRID);
    assertEquals(
        "FIDO2's transport should be matched",
        WebAuthnUtils.getTransportsForByte(transports),
        expectedFidoTransports);

    final String[] expectedJsonTransports =
        new String[] {"usb", "nfc", "ble", "internal", "hybrid"};
    final JSONArray array = WebAuthnUtils.getJSONTransportsForByte(transports);
    for (int i = 0; i < 5; i++) {
      assertEquals("JSON's transport should be matched", array.get(i), expectedJsonTransports[i]);
    }
  }
}
