const dns = require("node:dns");
dns.setServers(["1.1.1.1", "1.0.0.1"]);

const express = require("express");
const dontenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { jwtVerify, createRemoteJWKSet } = require("jose-cjs");
const { title } = require("node:process");
dontenv.config();

const uri = process.env.MONGODB_URI;

const app = express();
const PORT = process.env.PORT;

app.use(
  cors({
    credentials: true,
    origin: [process.env.CLIENT_URL],
  }),
);
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer")) {
    return res.status(401).json({ msg: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ msg: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;

    next();
  } catch (error) {
    console.log(error);
    return res.status(401).json({ msg: "Unauthorized" });
  }
};

const sellerVerify = async (req, res, next) => {
  const user = req.user;
  if (user.role !== "seller" || user.plan != "pro") {
    return res.status(403).json({ msg: "Forbidden" });
  }
  next();
};

async function run() {
  try {
    await client.connect();
    const db = client.db("tech-bazaar");
    const subscriptionsCollection = db.collection("subscriptions");
    const userCollection = db.collection("user");
    const productCollection = db.collection("products");
    // আপনার বাকি কালেকশনগুলোর সাথে এটিও লিখে রাখুন
    const paymentCollection = db.collection("payments");

    app.post("/subscription", async (req, res) => {
      const { sessionId, userId, priceId } = req.body;

      const isExist = await subscriptionsCollection.findOne({ sessionId });
      if (isExist) {
        return res.json({ msg: "Already exist!" });
      }

      await subscriptionsCollection.insertOne({
        sessionId,
        userId,
        priceId,
      });

      //update user role
      await userCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { plan: "pro" } },
      );

      res.json({ msg: "Payment successfull!" });
    });

    app.post(
      "/seller/products",
      verifyToken,
      sellerVerify,
      async (req, res) => {
        const data = req.body;
        const result = await productCollection.insertOne({
          ...data,
          userId: req.user.id,
        });

        res.send(result);
      },
    );

    app.get("/seller/products", verifyToken, sellerVerify, async (req, res) => {
      const { page = 1, limit = 10 } = req.query;
      const skip = (Number(page) - 1) * Number(limit);

      const result = await productCollection
        .find({ userId: req.user.id })
        .skip(skip)
        .limit(Number(limit))
        .toArray();

      const totalData = await productCollection.countDocuments({
        userId: req.user.id,
      });

      const totalPage = Math.ceil(totalData / Number(limit));

      res.send({ data: result, page: Number(page), totalPage });
    });

    app.get("/products", async (req, res) => {
      const { search } = req.query;
      const query = {};
      if (search && search != "undefined") {
        query.$or = [
          { title: { $regex: search, $options: "i" } },
          {
            description: { $regex: search, $options: "i" },
          },
        ];
      }

      const result = await productCollection.find(query).toArray();

      res.send(result);
    });

    app.get("/product/:id", async (req, res) => {
      const id = req.params.id;
      const result = await productCollection.findOne({ _id: new ObjectId(id) });

      res.send(result);
    });

    app.post("/payment", async (req, res) => {
      const data = req.body;

      // শুধু পেমেন্টের ডাটা কালেকশনে ইনসার্ট হবে, কোনো জটিল লজিক নাই
      const result = await paymentCollection.insertOne({
        productId: new ObjectId(data.productId),
        userId: data.userId,
        userEmail: data.userEmail,
        transactionId: data.sessionId,
        price: Number(data.price),
        title: data.title,
        status: "Paid",
        createdAt: new Date(),
      });

      // সরাসরি রেজাল্ট রেসপন্স পাঠানো
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running fine!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
