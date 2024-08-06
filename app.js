  const express = require('express')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const path = require('path')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const databasePath = path.join(__dirname, 'twitterClone.db')
const app = express()
app.use(express.json())
let db = null

const intializeDbAndServer = async (request, response) => {
  try {
    db = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server is Running at http://localhost:3000/')
    })
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(1)
  }
}

intializeDbAndServer()

const getFollowingPeopleIdsOfUser = async username => {
  const getTheFollowingPeopleQuery = `SELECT following_user_id FROM follower INNER JOIN user ON user.user_id=follower.follower_user_id WHERE user.username='${username}';`
  const followingPeople = await db.all(getTheFollowingPeopleQuery)
  const arrayOfIds = followingPeople.map(eachUser => eachUser.following_user_id)
  return arrayOfIds
}

const authenticateToken = (request, response, next) => {
  let jwtToken
  const autHeaders = request.headers['authorization']
  if (autHeaders !== undefined) {
    jwtToken = autHeaders.split(' ')[1]
  }
  if (jwtToken == undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'SECRET', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        request.userId = payload.user_id
        next()
      }
    })
  }
}

const tweetAccessVerification = async (request, response, next) => {
  const {userId} = request
  const {tweetId} = request.params
  const getTweetQuery = `SELECT * FROM tweet INNER JOIN follower ON tweet.user_id=follower.following_user_id WHERE tweet.tweet_id='${tweetId}' AND follower_user_id='${userId}';`
  const tweet = await db.get(getTweetQuery)
  if (tweet == undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const selectUserQuery = `SELECT * FROM user WHERE username='${username}';`
  const dbUser = await db.get(selectUserQuery)
  if (dbUser == undefined) {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const hashedPassword = await bcrypt.hash(password, 10)
      const createUserQuery = `INSERT INTO user(username,password,name,gender) VALUES ('${username}','${hashedPassword}','${name}','${gender}');`
      await db.run(createUserQuery)
      response.status(200)
      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

app.post('/login', async (request, response) => {
  const {username, password} = request.body
  const selectUserQuery = `SELECT * FROM user WHERE username='${username}';`
  const dbUser = await db.get(selectUserQuery)
  if (dbUser == undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordCorrect = await bcrypt.compare(password, dbUser.password)
    if (isPasswordCorrect === true) {
      const payload = {username, userId: dbUser.user_id}
      const jwtToken = jwt.sign(payload, 'SECRET')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

app.get('/user/tweets/feed', authenticateToken, async (request, response) => {
  const {username} = request
  const followingPeopleIds = await getFollowingPeopleIdsOfUser(username)
  const getTweetsFeedQuery = `SELECT username,tweet,date_time AS dateTime FROM user INNER JOIN tweet ON user.user_id=tweet.user_id WHERE user.user_id IN (${followingPeopleIds}) ORDER BY date_time DESC LIMIT 4;`
  const tweetFeedArray = await db.all(getTweetsFeedQuery)
  response.send(tweetFeedArray)
})

app.get('/user/following', authenticateToken, async (request, response) => {
  const {username, userId} = request
  const userFollowsQuery = `SELECT name FROM follower INNER JOIN user ON user.user_id=follower.following_user_id WHERE follower_user_id='${userId}';`
  const userFollowsArray = await db.all(userFollowsQuery)
  response.send(userFollowsArray)
})

app.get('/user/followers', authenticateToken, async (request, response) => {
  const {username, userId} = request
  const userFollowersQuery = `SELECT DISTINCT name FROM follower INNER JOIN user ON user.user_id=follower.follower_user_id WHERE following_user_id='${userId}';`
  const userFollowersArray = await db.all(userFollowersQuery)
  response.send(userFollowersArray)
})

app.get(
  '/tweets/:tweetId',
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const {username, userId} = request
    const {tweetId} = request.params
    const userFollowersQuery = `SELECT tweet,
    (SELECT COUNT() FROM like WHERE tweet_id='${tweetId}') AS likes, 
    (SELECT COUNT() FROM reply WHERE tweet_id='${tweetId}') AS replies,
    date_time AS dateTime 
    FROM tweet 
    WHERE tweet.tweet_id='${tweetId}';`
    const userFollowers = await db.all(userFollowersQuery)
    response.send(userFollowers)
  },
)

app.get(
  '/tweets/:tweetId/likes',
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getLIkedUsersQuery = `SELECT username 
    FROM user INNER JOIN like ON user.user_id=like.user_id 
    WHERE tweet_id='${tweetId}';`
    const likedUsers = await db.all(getLIkedUsersQuery)
    const usersArray = likedUsers.map(eachUser => eachUser.username)
    response.send({likes: usersArray})
  },
)

app.get(
  '/tweets/:tweetId/replies',
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getRepliedUserQuery = `SELECT name,reply 
    FROM user INNER JOIN reply ON user.user_id=reply.user_id 
    WHERE tweet_id='${tweetId}';`
    const repliedUsers = await db.all(getRepliedUserQuery)
    response.send({replies: repliedUsers})
  },
)

app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const {userId} = request
  const getTweetsDetailsQuery = `SELECT tweet, 
  COUNT(DISTINCT like_id) AS likes,
  COUNT(DISTINCT reply_id) AS replies,
  date_time AS dateTime FROM tweet LEFT JOIN reply ON tweet.tweet_id=reply.tweet_id 
  LEFT JOIN like ON tweet.tweet_id=like.tweet_id 
  WHERE tweet.user_id=${userId} 
  GROUP BY tweet.tweet_id;`
  const tweetsDetails = await db.all(getTweetsDetailsQuery)
  response.send(tweetsDetails)
})

app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const {tweet} = request.body
  const userId = parseInt(request.userId)
  const dateTime = new Date().toJSON().substring(0, 19).replace('T', ' ')
  const posttweetQuery = `INSERT INTO tweet(tweet,user_id,date_time) VALUES('${tweet}','${userId}','${dateTime}');`
  await db.run(posttweetQuery)
  response.send('Created a Tweet')
})

app.delete('/tweets/:tweetId', authenticateToken, async (request, response) => {
  const {tweetId} = request.params
  const {userId} = request
  const selectUserQuery = `SELECT * FROM tweet WHERE user_id='${userId}' AND tweet_id='${tweetId}';`
  const tweetUser = await db.all(selectUserQuery)
  if (tweetUser == undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id='${tweetId}';`
    await db.run(deleteTweetQuery)
    response.send('Tweet Removed')
  }
})

module.exports = app

