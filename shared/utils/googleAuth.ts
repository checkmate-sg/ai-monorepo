const objectToBase64url = (object: object) => {
  const encoded = new TextEncoder().encode(JSON.stringify(object));
  return arrayBufferToBase64Url(encoded.buffer as ArrayBuffer);
};

const arrayBufferToBase64Url = (buffer: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

const str2ab = (str: string) => {
  const buf = new ArrayBuffer(str.length);
  const bufView = new Uint8Array(buf);
  for (let i = 0, strLen = str.length; i < strLen; i += 1) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
};

const sign = async (content: string, signingKey: string) => {
  const buf = str2ab(content);
  const plainKey = signingKey
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/(\r\n|\n|\r)/gm, "");
  const binaryKey = str2ab(atob(plainKey));
  const signer = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    {
      name: "RSASSA-PKCS1-V1_5",
      hash: { name: "SHA-256" },
    },
    false,
    ["sign"]
  );
  const binarySignature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-V1_5" },
    signer,
    buf
  );
  return arrayBufferToBase64Url(binarySignature);
};

export const getGoogleAuthToken = async (
  user: string,
  key: string,
  scope: string
): Promise<string> => {
  const jwtHeader = objectToBase64url({ alg: "RS256", typ: "JWT" });
  try {
    const assertiontime = Math.round(Date.now() / 1000);
    const expirytime = assertiontime + 3600;
    const claimset = objectToBase64url({
      iss: user,
      scope,
      aud: "https://oauth2.googleapis.com/token",
      exp: expirytime,
      iat: assertiontime,
    });

    const jwtUnsigned = `${jwtHeader}.${claimset}`;
    const signature = await sign(jwtUnsigned, key);
    const signedJwt = `${jwtUnsigned}.${signature}`;
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${signedJwt}`;
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cache-Control": "no-cache",
        Host: "oauth2.googleapis.com",
      },
      body,
    });
    const responseData = (await response.json()) as { access_token: string };
    return responseData.access_token;
  } catch (err) {
    throw err;
  }
};

// For Cloud Run, we need to create a self-signed JWT token directly
export const getGoogleIdToken = async (
  user: string,
  key: string,
  cloudRunUrl: string
): Promise<string> => {
  const jwtHeader = objectToBase64url({ alg: "RS256", typ: "JWT" });

  try {
    const assertionTime = Math.round(Date.now() / 1000);
    const expiryTime = assertionTime + 3600;
    // Set the audience to the Cloud Run service URL
    const claimset = objectToBase64url({
      iss: user,
      sub: user,
      aud: "https://oauth2.googleapis.com/token",
      exp: expiryTime,
      iat: assertionTime,
      target_audience: cloudRunUrl,
    });

    const jwtUnsigned = `${jwtHeader}.${claimset}`;
    const signature = await sign(jwtUnsigned, key);
    const signedJwt = `${jwtUnsigned}.${signature}`;

    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${signedJwt}`;

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const responseData = (await response.json()) as any;
    // The key we need is "id_token" instead of "access_token"
    if (!responseData.id_token) {
      throw new Error(
        `Failed to obtain ID token: ${JSON.stringify(responseData)}`
      );
    }

    return responseData.id_token;
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Error generating access token: ${err.message}`);
    }
    throw new Error(`Error generating access token: ${err}`);
  }
};
