# VINote Mobile

VINote 的原生移动客户端仓库。

## 当前阶段

仓库目前仅完成初始化，用于确认独立仓库、父项目关联方式和后续提交历史。React Native 技术选型与业务代码将在方案讨论完成后开始。

## 计划边界

- 使用 React Native 原生工程，不使用 Expo。
- 面向 iOS 与 Android。
- 复用 VINote 现有后端服务和产品视觉语言。
- 移动端拥有独立版本、构建流程和发布流程。

## 与父项目的关系

主项目仓库：<https://github.com/orulink-ai/VINote>

本仓库作为独立 Git 仓库维护，并通过 Git submodule 关联到 VINote 父仓库的 `VINote-Mobile/` 目录。父仓库记录经过确认的移动端提交版本。
