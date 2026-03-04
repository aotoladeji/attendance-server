# AttendX — Central Attendance Server

## Quick Start

### 1. Install & Run
```bash
npm install
node server.js
```
Server starts at http://localhost:3000

### 2. For LAN use (all Android devices on same WiFi)
Find your PC/laptop IP:
- Windows: `ipconfig` → IPv4 Address
- Mac/Linux: `ifconfig` or `ip addr`

Your apps connect to: `http://192.168.x.x:3000`

### 3. Dashboard
Open browser → http://localhost:3000
- Upload your Excel file
- Set a session name
- Click "Activate" to make it live

---

## Excel File Format
| Student ID | Name           |
|------------|----------------|
| STU001     | Alice Johnson  |
| STU002     | Bob Smith      |

Column names are auto-detected. Common aliases work:
- ID: `id`, `student_id`, `matric`, `reg_no`, `roll`
- Name: `name`, `fullname`, `student_name`

---

## Android App API Reference
Base URL: `http://YOUR-SERVER-IP:3000`

### Check active session (call on app launch)
```
GET /api/app/session
```
Response:
```json
{ "sessionId": "ABC123", "sessionName": "CS101 Lecture 5", "studentCount": 45, "presentCount": 12 }
```

### Fetch all students + status
```
GET /api/app/students
```
Response:
```json
{ "students": [{ "id": "STU001", "name": "Alice", "attended": false }, ...] }
```

### Check if student already attended
```
GET /api/app/check/STU001
```
Response:
```json
{ "studentId": "STU001", "name": "Alice Johnson", "attended": false, "markedAt": null }
```

### Mark attendance (duplicate-safe)
```
POST /api/app/mark
Content-Type: application/json

{ "studentId": "STU001", "device": "tablet-1" }
```

Success (200):
```json
{ "success": true, "message": "Attendance marked for Alice Johnson", "student": {...}, "markedAt": 1712345678 }
```

Already marked (409 — handle this in your app):
```json
{ "error": "duplicate", "message": "Alice Johnson already marked present", "markedAt": 1712345678 }
```

---

## Android Code Snippet (Retrofit/OkHttp)

```kotlin
// Mark attendance
val client = OkHttpClient()
val json = JSONObject().apply {
    put("studentId", studentId)
    put("device", Build.MODEL)
}
val body = RequestBody.create("application/json".toMediaType(), json.toString())
val request = Request.Builder()
    .url("http://192.168.1.100:3000/api/app/mark")
    .post(body)
    .build()

client.newCall(request).enqueue(object : Callback {
    override fun onResponse(call: Call, response: Response) {
        if (response.code == 409) {
            // Already marked — show message to student
        } else if (response.isSuccessful) {
            // Attendance recorded!
        }
    }
    override fun onFailure(call: Call, e: IOException) {
        // Network error — check server connection
    }
})
```

---

## Deploy to Cloud (optional)
For internet access (not just local WiFi):

**Railway:** `railway up` after installing Railway CLI
**Render:** Connect GitHub repo, set start command to `node server.js`
**VPS:** Upload files, run with `pm2 start server.js`

Remember to update Android app's BASE_URL to the cloud URL.
