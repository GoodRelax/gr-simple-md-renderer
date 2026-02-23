## 7. Data Flow

### 7.1 Encode Data Flow

**contents_name:**
encode_data_flow

```mermaid
sequenceDiagram
    participant User
    participant Main as main.js
    participant Encode as EncodeUseCase
    participant Comp as CompressorAdapter
    participant Cap as CapacityCalc
    participant Img as ImageAdapter
    participant Pack as MatryoshkaPacker
    participant Crypto as CryptoAdapter
    participant Stripe as StripingEngine
    participant Lsb as LsbEngine

    User ->> Main : drop(TreasureMapFile, OriginalCatFile, OriginalDogFile)
    Note over Main: Assemble adapter dependencies
    Main ->> Encode : execute(tmBytes, fileName, catRaw, dogRaw, catWidth, catHeight, deps)

    Encode ->> Comp : compress(tmBytes)
    Comp -->> Encode : return compressedTM

    Encode ->> Cap : selectResolution(compressedTM.length, fileNameByteLen, catWidth, catHeight)
    Cap -->> Encode : return {newWidth, newHeight, capacityPerCarrier, label}

    Encode ->> Img : resizeStretch(catRaw, newWidth, newHeight)
    Img -->> Encode : return resizedCatPixels
    Encode ->> Img : resizeStretch(dogRaw, newWidth, newHeight)
    Img -->> Encode : return resizedDogPixels

    Encode ->> Pack : packLayer3(compressedTM, fileName, layer3Capacity)
    Pack -->> Encode : return plaintext

    Encode ->> Crypto : encrypt(plaintext)
    Crypto -->> Encode : return {key, iv, ciphertext}

    Encode ->> Pack : packLayer2(key, iv, ciphertext)
    Pack -->> Encode : return encryptedStream

    Encode ->> Stripe : stripe(encryptedStream)
    Stripe -->> Encode : return {evenBytes, oddBytes}

    Encode ->> Pack : packLayer1(evenBytes, isEven_true, randGen)
    Pack -->> Encode : return catPayload
    Encode ->> Pack : packLayer1(oddBytes, isEven_false, randGen)
    Pack -->> Encode : return dogPayload

    Encode ->> Lsb : lsbInterleave(resizedCatPixels, catPayload, 3)
    Lsb -->> Encode : return catStegoPixels
    Encode ->> Lsb : lsbInterleave(resizedDogPixels, dogPayload, 3)
    Lsb -->> Encode : return dogStegoPixels

    Encode -->> Main : return {catStegoPixels, dogStegoPixels, width, height, compressedSize, label}
    Main ->> Img : toBlob(catStegoPixels, width, height)
    Main ->> Img : toBlob(dogStegoPixels, width, height)
    Main -->> User : hide spinner and enable download and preview
```

### 7.2 Decode Data Flow

**contents_name:**
decode_data_flow

```mermaid
sequenceDiagram
    participant User
    participant Main as main.js
    participant Decode as DecodeUseCase
    participant Img as ImageAdapter
    participant Lsb as LsbEngine
    participant Pack as MatryoshkaPacker
    participant Stripe as StripingEngine
    participant Crypto as CryptoAdapter
    participant Comp as CompressorAdapter

    User ->> Main : drop(File1, File2)
    Main ->> Decode : execute(file1Raw, file2Raw, deps)

    Decode ->> Img : loadPixels(file1Raw)
    Img -->> Decode : return pixels1
    Decode ->> Img : loadPixels(file2Raw)
    Img -->> Decode : return pixels2

    Decode ->> Pack : unpackLayer1Id(pixels1, pixels2)
    Pack -->> Decode : return {catPixels, dogPixels}
    Note right of Decode: Validates Even/Odd parity

    Decode ->> Lsb : lsbDeinterleave(catPixels, catTotalBits, 3)
    Lsb -->> Decode : return catLsbBytes
    Decode ->> Lsb : lsbDeinterleave(dogPixels, dogTotalBits, 3)
    Lsb -->> Decode : return dogLsbBytes

    Decode ->> Pack : unpackLayer1Data(catLsbBytes)
    Pack -->> Decode : return catStripedData
    Decode ->> Pack : unpackLayer1Data(dogLsbBytes)
    Pack -->> Decode : return dogStripedData

    Decode ->> Stripe : weave(catStripedData, dogStripedData)
    Stripe -->> Decode : return encryptedStream

    Decode ->> Pack : unpackLayer2(encryptedStream)
    Pack -->> Decode : return {key, iv, ciphertext}

    Decode ->> Crypto : decrypt(ciphertext, key, iv)
    Crypto -->> Decode : return plaintext

    Decode ->> Pack : unpackLayer3(plaintext)
    Pack -->> Decode : return {fileName, compressedTM}

    Decode ->> Comp : decompress(compressedTM)
    Comp -->> Decode : return treasureMapBytes

    Decode -->> Main : return {fileName, treasureMapBytes}
    Main -->> User : hide spinner and enable download(fileName)
```

# Super Big Sequence Diagram in PlantUML

```puml
@startuml
participant "User" as User
participant "CDN" as CDN
participant "LoadBalancer" as LB
participant "WAF" as WAF
participant "APIGateway" as API
participant "AuthServer" as Auth
participant "UserDB" as UDB
participant "SessionMgr" as Sess
participant "main.js" as Main
participant "VirusScanner" as Scan
participant "FormatChecker" as Chk
participant "MetaDataParser" as Meta
participant "ResourceMonitor" as Mon
participant "LogServer" as Log
participant "MetricsCollector" as Met
participant "ConfigDB" as Cfg
participant "EncodeUseCase" as Encode
participant "TmpStorage" as Tmp
participant "AuditDB" as Audit
participant "CompressorAdapter" as Comp
participant "CapacityCalc" as Cap
participant "ImageAdapter" as Img
participant "MatryoshkaPacker" as Pack
participant "KeyManagement" as KMS
participant "CryptoAdapter" as Crypto
participant "StripingEngine" as Stripe
participant "LsbEngine" as Lsb
participant "Analytics" as Analyt
participant "CleanupService" as Clean
participant "Notifier" as Notif

User -> CDN: drop(TreasureMapFile, OriginalCat, OriginalDog)
CDN -> LB: forward request
LB -> WAF: inspect payload
WAF --> LB: payload clean
LB -> API: route request
API -> Main: init encode process
Main -> Auth: validate token
Auth -> UDB: query user status
UDB --> Auth: user active
Auth --> Main: token valid
Main -> Sess: update session heartbeat
Sess --> Main: session updated
Main -> Scan: scan files for malware
Scan --> Main: files safe
Main -> Chk: verify file formats
Chk --> Main: formats supported
Main -> Meta: extract metadata
Meta --> Main: metadata parsed
Main -> Mon: check memory availability
Mon --> Main: memory sufficient
Main -> Log: log process start
Log --> Main: logged
Main -> Met: increment request counter
Met --> Main: metrics updated
Main -> Cfg: fetch encode parameters
Cfg --> Main: params loaded

Main -> Encode: execute(tmBytes, fileName, catRaw, dogRaw, ...)
Encode -> Tmp: store raw inputs temporarily
Tmp --> Encode: stored
Encode -> Audit: log encode initialization
Audit --> Encode: logged

Encode -> Comp: compress(tmBytes)
Comp --> Encode: return compressedTM
Encode -> Log: log compression ratio
Log --> Encode: logged

Encode -> Cap: selectResolution(compressedTM.length, ...)
Cap --> Encode: return {newWidth, newHeight, capacity}

Encode -> Img: resizeStretch(catRaw, newWidth, newHeight)
Img --> Encode: return resizedCatPixels
Encode -> Img: resizeStretch(dogRaw, newWidth, newHeight)
Img --> Encode: return resizedDogPixels

Encode -> Pack: packLayer3(compressedTM, fileName)
Pack --> Encode: return plaintext

Encode -> KMS: request encryption key
KMS --> Encode: return key and iv
Encode -> Crypto: encrypt(plaintext, key, iv)
Crypto --> Encode: return ciphertext
Encode -> Audit: log encryption success
Audit --> Encode: logged

Encode -> Pack: packLayer2(key, iv, ciphertext)
Pack --> Encode: return encryptedStream

Encode -> Stripe: stripe(encryptedStream)
Stripe --> Encode: return {evenBytes, oddBytes}

Encode -> Pack: packLayer1(evenBytes, isEven_true)
Pack --> Encode: return catPayload
Encode -> Pack: packLayer1(oddBytes, isEven_false)
Pack --> Encode: return dogPayload

Encode -> Lsb: lsbInterleave(resizedCatPixels, catPayload, 3)
Lsb --> Encode: return catStegoPixels
Encode -> Lsb: lsbInterleave(resizedDogPixels, dogPayload, 3)
Lsb --> Encode: return dogStegoPixels

Encode -> Tmp: store stego outputs temporarily
Tmp --> Encode: stored
Encode -> Analyt: record generation metrics
Analyt --> Encode: recorded

Encode --> Main: return {catStegoPixels, dogStegoPixels, ...}

Main -> Img: toBlob(catStegoPixels, width, height)
Img --> Main: return catBlob
Main -> Img: toBlob(dogStegoPixels, width, height)
Img --> Main: return dogBlob

Main -> Clean: trigger temp file cleanup
Clean --> Main: cleanup complete
Main -> Notif: prepare download URLs
Notif --> Main: URLs ready

Main --> API: response ready
API --> LB: route response
LB --> CDN: forward response
CDN --> User: hide spinner and enable download
@enduml
```

# Super Big Sequence Diagram in Mermaid

```mermaid
sequenceDiagram
    participant User
    participant CDN
    participant LB as LoadBalancer
    participant WAF
    participant API as APIGateway
    participant Auth as AuthServer
    participant UDB as UserDB
    participant Sess as SessionMgr
    participant Main as main.js
    participant Scan as VirusScanner
    participant Chk as FormatChecker
    participant Meta as MetaDataParser
    participant Mon as ResourceMonitor
    participant Log as LogServer
    participant Met as MetricsCollector
    participant Cfg as ConfigDB
    participant Encode as EncodeUseCase
    participant Tmp as TmpStorage
    participant Audit as AuditDB
    participant Comp as CompressorAdapter
    participant Cap as CapacityCalc
    participant Img as ImageAdapter
    participant Pack as MatryoshkaPacker
    participant KMS as KeyManagement
    participant Crypto as CryptoAdapter
    participant Stripe as StripingEngine
    participant Lsb as LsbEngine
    participant Analyt as Analytics
    participant Clean as CleanupService
    participant Notif as Notifier

    User ->> CDN: drop(TreasureMapFile, OriginalCat, OriginalDog)
    CDN ->> LB: forward request
    LB ->> WAF: inspect payload
    WAF -->> LB: payload clean
    LB ->> API: route request
    API ->> Main: init encode process
    Main ->> Auth: validate token
    Auth ->> UDB: query user status
    UDB -->> Auth: user active
    Auth -->> Main: token valid
    Main ->> Sess: update session heartbeat
    Sess -->> Main: session updated
    Main ->> Scan: scan files for malware
    Scan -->> Main: files safe
    Main ->> Chk: verify file formats
    Chk -->> Main: formats supported
    Main ->> Meta: extract metadata
    Meta -->> Main: metadata parsed
    Main ->> Mon: check memory availability
    Mon -->> Main: memory sufficient
    Main ->> Log: log process start
    Log -->> Main: logged
    Main ->> Met: increment request counter
    Met -->> Main: metrics updated
    Main ->> Cfg: fetch encode parameters
    Cfg -->> Main: params loaded

    Main ->> Encode: execute(tmBytes, fileName, catRaw, dogRaw, ...)
    Encode ->> Tmp: store raw inputs temporarily
    Tmp -->> Encode: stored
    Encode ->> Audit: log encode initialization
    Audit -->> Encode: logged

    Encode ->> Comp: compress(tmBytes)
    Comp -->> Encode: return compressedTM
    Encode ->> Log: log compression ratio
    Log -->> Encode: logged

    Encode ->> Cap: selectResolution(compressedTM.length, ...)
    Cap -->> Encode: return {newWidth, newHeight, capacity}

    Encode ->> Img: resizeStretch(catRaw, newWidth, newHeight)
    Img -->> Encode: return resizedCatPixels
    Encode ->> Img: resizeStretch(dogRaw, newWidth, newHeight)
    Img -->> Encode: return resizedDogPixels

    Encode ->> Pack: packLayer3(compressedTM, fileName)
    Pack -->> Encode: return plaintext

    Encode ->> KMS: request encryption key
    KMS -->> Encode: return key and iv
    Encode ->> Crypto: encrypt(plaintext, key, iv)
    Crypto -->> Encode: return ciphertext
    Encode ->> Audit: log encryption success
    Audit -->> Encode: logged

    Encode ->> Pack: packLayer2(key, iv, ciphertext)
    Pack -->> Encode: return encryptedStream

    Encode ->> Stripe: stripe(encryptedStream)
    Stripe -->> Encode: return {evenBytes, oddBytes}

    Encode ->> Pack: packLayer1(evenBytes, isEven_true)
    Pack -->> Encode: return catPayload
    Encode ->> Pack: packLayer1(oddBytes, isEven_false)
    Pack -->> Encode: return dogPayload

    Encode ->> Lsb: lsbInterleave(resizedCatPixels, catPayload, 3)
    Lsb -->> Encode: return catStegoPixels
    Encode ->> Lsb: lsbInterleave(resizedDogPixels, dogPayload, 3)
    Lsb -->> Encode: return dogStegoPixels

    Encode ->> Tmp: store stego outputs temporarily
    Tmp -->> Encode: stored
    Encode ->> Analyt: record generation metrics
    Analyt -->> Encode: recorded

    Encode -->> Main: return {catStegoPixels, dogStegoPixels, ...}

    Main ->> Img: toBlob(catStegoPixels, width, height)
    Img -->> Main: return catBlob
    Main ->> Img: toBlob(dogStegoPixels, width, height)
    Img -->> Main: return dogBlob

    Main ->> Clean: trigger temp file cleanup
    Clean -->> Main: cleanup complete
    Main ->> Notif: prepare download URLs
    Notif -->> Main: URLs ready

    Main -->> API: response ready
    API -->> LB: route response
    LB -->> CDN: forward response
    CDN -->> User: hide spinner and enable download
```
