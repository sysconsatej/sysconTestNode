const md5 = require("md5");
const validate = require("../helper/validate");
const moment = require("moment");
const jwt = require("jsonwebtoken");
const SendMail = require("../helper/NodeMailer");
const config = require("../config/auth.config");
const Mailtemplate = require("../helper/Mailtemplate");
const client = require("../redis/redis_client");
const { executeStoredProcedure, executeQuery } = require("../modelSQL/model");
const Redis_expire_time = process.env.REDIS_EXPIRE_TIME;

const generateOTP = () => {
  // Generate a random number between 100000 and 999999
  const otp = Math.floor(100000 + Math.random() * 900000);
  return otp.toString();
};

const userFindByEmail = async (email) => {
  let userKey = "userWrongPassword";
  let serializedList = await client.lrange(userKey, 0, -1);
  const userFound = serializedList.some((item) => {
    let user = JSON.parse(item);
    return user.email === email;
  });

  return userFound;
};

const loginFailHandler = async (isExits, userData) => {
  let userKey = "userWrongPassword";
  let serializedList = await client.lrange(userKey, 0, -1);
  let userActive = 0;
  if (isExits) {
    const currentDate = new Date();
    const twoHoursAgo = new Date(currentDate.getTime() - 2 * 60 * 60 * 1000);
    const updatedList = [];
    for (let i = 0; i < serializedList.length; i++) {
      let user = JSON.parse(serializedList[i]);
      if (user.id === userData.id) {
        user.count += 1; // Increment count for the user
        userActive = user.count;
        if (user.count === 3) {
          user.date = Date.now();
        }
        if (user.date < twoHoursAgo) {
          user.count = 3;
          userActive = user.count;
          user.date = Date.now();
        }
      }
      updatedList.push(JSON.stringify(user));
    }
    await client.del(userKey);
    await client.rpush(userKey, ...updatedList);
  } else {
    let newUser = JSON.stringify({
      id: userData.id,
      email: userData.emailId,
      count: 1, // Start count at 1 for new users
    });
    await client.rpush(userKey, newUser);
  }
  return userActive;
};

const userFindByEmailLogin = async (email) => {
  let userKey = "userWrongPassword";
  let wrongPassNum = 0;
  let serializedList = await client.lrange(userKey, 0, -1);
  const userFound = serializedList.find((item) => {
    let user = JSON.parse(item);
    if (user.email === email) {
      wrongPassNum = user.count;
    }
  });

  return wrongPassNum;
};

function isDateOlderThan60Days(dateString) {
  const inputDate = new Date(dateString);
  const currentDate = new Date();
  const timeDifference = currentDate - inputDate;
  const differenceInDays = timeDifference / (1000 * 60 * 60 * 24);
  return differenceInDays > process.env.RESET_PASSWORD_DAYS;
}

module.exports = {
  login: async (req, res) => {
    const validationRule = {
      userName: "required",
      password: "required",
    };
    validate(req.body, validationRule, {}, async (err, status) => {
      if (!status) {
        res.status(412).send({
          success: false,
          message: "Validation error",
          data: err,
        });
      } else {
        try {
          const parameters = {
            emailId: req.body.userName,
            password: md5(req.body.password),
            clientCode: req.body.clientCode,
          };
          let { data, success } = await executeStoredProcedure(
            "loginApi",
            parameters,
          );

          if (success) {
            const parameters = { themeId: data.themeId };
            let themeData = await executeStoredProcedure(
              "themeApi",
              parameters,
            );

            data = [{ theme: themeData, ...data }];

            let token = jwt.sign(
              {
                id: data[0].id,
                userName: data[0].emailId,
                iat: Date.now(),
                numberFormat: data[0].numberFormat,
                clientCode: data[0].clientCode || "NCLP",
                clientId: data[0].clientId,
              },
              config.secret,
              { expiresIn: 7200000 },
            );

            try {
              const checkWrongPass = await userFindByEmailLogin(
                data[0].emailId,
              );
              if (checkWrongPass > 2) {
                return res.status(400).send({
                  success: false,
                  message: "User is Inactive",
                  data: [],
                });
              } else {
                const sessionExpiry = Redis_expire_time; // 2 days
                const sessionKey = `user:${data[0].emailId}:session`;
                // Check if user already exists
                let userExists = await client.exists(sessionKey);
                const emailId = data[0].emailId;

                if (
                  !emailId.toLowerCase().endsWith("@sysconinfotech.com") &&
                  isDateOlderThan60Days(data[0].passwordLastUpdateDate)
                ) {
                  return res.status(200).send({
                    success: "60DaysResetPassword",
                    message: "60DaysResetPassword",
                    token: token,
                    data: data,
                  });
                } else if (userExists) {
                  return res.status(200).send({
                    success: "active",
                    message: "User already exists and is active!",
                    token: token,
                    data: data,
                  });
                } else {
                  await client.expire(sessionKey, sessionExpiry);
                  // Store session data with expiration
                  await client.hmset(sessionKey, {
                    email: data[0].emailId,
                    token: token,
                  });

                  return res.send({
                    success: true,
                    message: "User Login Successfully.",
                    token: token,
                    data: data,
                  });
                }
              }
            } catch (error) {
              console.error("Error setting value in Redis:", error);
              return res.status(500).send({
                success: false,
                message: "Internal Server Error",
              });
            }
          } else {
            const parameters = {
              emailId: req.body.userName,
              password: md5(req.body.password),
              clientCode: req.body.clientCode,
            };
            let { error, data } = await executeStoredProcedure(
              "loginApi",
              parameters,
            );

            if (error == "Password is not valid!") {
              let findUser = await userFindByEmail(data.emailId);
              let userActive = await loginFailHandler(findUser, data);

              if (userActive === 3) {
                res.status(403).send({
                  success: false,
                  message:
                    "Your account status is disabled. We have sent you an activation email. Kindly click on the activation link to activate your account.",
                  data: data.emailId,
                });
                return; // Exit the function after sending the response
              }

              if (userActive >= 3) {
                res.status(403).send({
                  success: false,
                  message: "Email can only be sent once every 2 hours.",
                  data: data.emailId,
                });
                return; // Exit the function after sending the response
              }
              res.status(403).send({
                success: false,
                message: "Invalid Password",
                data: [],
              });
            } else {
              console.log("Invalid UserName");
              res.status(403).send({
                success: false,
                message: "Invalid UserName",
                data: [],
              });
            }
          }
        } catch (error) {
          //errorLogger(error, req);
          res.status(500).send({
            success: false,
            message: "Error - " + error.message,
            data: error.message,
          });
        }
      }
    });
  },
  changePassword: async (req, res) => {
    let validationRule = {
      userName: "required",
      newPassword: "required",
    };

    validate(req.body, validationRule, {}, async (err, status) => {
      if (!status) {
        res.status(403).send({
          success: false,
          message: "Validation error",
          data: err,
        });
      } else {
        try {
          if (
            req.body.forgotPassword &&
            (req.body.forgotPassword == true ||
              req.body.forgotPassword == "true")
          ) {
            const parameters = {
              emailId: req.body.userName,
              newPassword: md5(req.body.newPassword),
            };
            let { data, error } = await executeStoredProcedure(
              "changePasswordApi",
              parameters,
            );

            if (data) {
              res.send({
                success: true,
                message: "Password Changed Successfully",
                data: data,
              });
            } else {
              res.status(400).send({
                success: false,
                message: "Password Not Changed",
                error: error,
              });
            }
          } else {
            res.status(400).send({
              success: false,
              message: "Forgot password is false",
              data: [],
            });
          }
        } catch (error) {
          //errorLogger(error, req);
          res.status(500).send({
            success: false,
            message: "Error - " + error.message,
            data: error.message,
          });
        }
      }
    });
  },
  resetPassword: async (req, res) => {
    try {
      const parameters = {
        emailId: req.body.emailId,
        oldPassword: md5(req.body.oldPassword),
        newPassword: md5(req.body.newPassword),
      };
      let { data, error } = await executeStoredProcedure(
        "resetPasswordApi",
        parameters,
      );

      if (data) {
        res.send({
          success: true,
          message: "Password Changed Successfully",
          data: data,
        });
      } else {
        res.status(400).send({
          success: false,
          message: "Password Not Changed",
          error: error,
        });
      }
    } catch (error) {
      //errorLogger(error, req);
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
  verifyEmail: async (req, res) => {
    const emailVal = req.body.email;
    try {
      let { data } = await executeStoredProcedure("forgotPasswordApi", {
        emailId: emailVal,
      });

      if (!data) {
        return res.status(404).json({
          success: false,
          message: "User not found!",
        });
      }
      const emailData = {
        from: "rohitanabhavane26@gmail.com",
        to: data.emailId,
        subject: "Verification Otp",
        name: data.name,
        OTP: generateOTP(),
      };
      return res.status(200).json({
        success: true,
        data: emailData,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Internal Server Error!",
      });
    }
  },
  logout: async (req, res) => {
    const { token } = req.body;
    const decoded = jwt.decode(token);
    try {
      const sessionKey = `user:${decoded.userName}:session`;
      await client.del(sessionKey);
      return res.send({
        success: true,
        message: "User Logout Successfully.",
      });
    } catch (error) {
      console.error("Error setting value in Redis:", error);
      return res.status(500).send({
        success: false,
        message: "Internal Server Error",
      });
    }
  },
  verifyRedisToken: async (req, res) => {
    const token = req.query.token;
    if (!token) {
      res.status(400).json({ success: false, message: "Token is required" });
    }
    const decoded = jwt.decode(token);
    try {
      const sessionKey = `user:${decoded.userName}:session`;
      // const exists = await client.exists(sessionKey);
      const storedToken = await client.hget(sessionKey, "token");
      let tokenValid = storedToken.trim() === token.trim();
      if (tokenValid) {
        await client.expire(sessionKey, Redis_expire_time);
        return res.status(200).json({ success: true });
      } else {
        return res
          .status(404)
          .json({ success: false, message: "Token not found" });
      }
    } catch (error) {
      return res
        .status(500)
        .json({ success: false, message: `server error ${error.message}` });
    }
  },
  menuAccessByEmailId: async (req, res) => {
    try {
      const parameters = { emailId: req.body.emailId };
      let { data, error } = await executeStoredProcedure(
        "menuAccessByEmailIdApi",
        parameters,
      );

      if (data) {
        res.send({
          success: true,
          message: "Get user data successfully!",
          data: data,
        });
      } else {
        res.status(400).send({
          success: false,
          message: "User not found!",
          error: error,
        });
      }
    } catch (error) {
      //errorLogger(error, req);
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
  news: async (req, res) => {
    const clientId = req.body.clientId;
    try {
      let data = await executeStoredProcedure("newsApi", {
        clientId: clientId,
      });

      if (!data) {
        return res.status(404).json({
          success: false,
          message: "No data found!",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Data fetch successfully!",
        data: data,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Internal Server Error!",
        error: error,
      });
    }
  },
  changeDeviceByRedis: async (req, res) => {
    const { emailId, token } = req.body;
    try {
      const sessionKey = `user:${emailId}:session`;
      await client.expire(sessionKey, Redis_expire_time);
      await client.hmset(sessionKey, {
        email: emailId,
        token: token,
      });

      return res.send({
        success: true,
        message: "User Change Device Successfully.",
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
  clearPassByRedis: async (req, res) => {
    const { id } = req.body;
    try {
      const userFindByEmailLogin = async (emailId) => {
        let userKey = "userWrongPassword";
        let serializedList = await client.lrange(userKey, 0, -1);
        for (const item of serializedList) {
          let user = JSON.parse(item);
          if (user.id === emailId) {
            await client.lrem(userKey, 1, item);
            console.log(`User with id ${emailId} removed from Redis`);
            return;
          }
        }
      };

      userFindByEmailLogin(id);

      return res.send({
        success: true,
        message: "User wrong password count clear!",
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
  getAllUsers: async (req, res) => {
    try {
      if (!req.clientId) {
        return res.status(400).json({
          success: false,
          message: "Bad Request  : Client Id is required",
        })
      }

      const keys = await client.keys("user:*:session");
      if (!keys.length) {
        return res.status(200).json({
          success: true,
          message: "No active users found.",
          data: [],
        });
      }

      const users = await Promise.all(
        keys.map(async (key) => {
          const session = await client.hgetall(key);
          return session;
        })
      );

      const query = `select u.id , u.name ,  u.profilePhoto  , u.emailId from  tblUser  u where clientid = ${req?.clientId}`
      const getUsersFromtheClientId = await executeQuery(query, {})

      const dbUsers = getUsersFromtheClientId?.["recordset"] ?? [];

      const activeUsers = [];
      const inactiveUsers = [];

      for (const dbUser of dbUsers) {
        let isActive = false;
        for (const user of users) {
          if (dbUser.emailId === user.email) {
            isActive = true;
            activeUsers.push({
              name: dbUser?.name,
              profilePhoto: dbUser?.profilePhoto,
              id : dbUser?.id,
            });
            break;
          }
        }
        if (!isActive) {
          inactiveUsers.push({
            name: dbUser.name,
            profilePhoto: dbUser.profilePhoto,
            id : dbUser?.id,
          });
        }
      }


      return res.status(200).json({
        success: true,
        message: "Active users fetched successfully.",
        data: {
          active: activeUsers,
          inactiveUsers: inactiveUsers,
        },
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Error - " + err.message,
        data: err.message,
      });
    }
  },
};
